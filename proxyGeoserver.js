var clientRequest = require("../httpclient").request;
var responseForStatus = require("../util").responseForStatus;
var Headers = require("ringo/utils/http").Headers;
var MemoryStream = require("io").MemoryStream;
var base64 = require("ringo/base64");
var objects = require("ringo/utils/objects");
var proxy = require("./proxy");

// import java.net.URL
var URL = java.net.URL;

// not needs login
var URLS_GEOSERVER_NO_PROXIED = [
    "getCapabilities", 
    "GetCapabilities", 
    "describeFeatureType",
    "DescribeFeatureType"
    //,
    //"wfs" //TODO: to edit wfs
    ];
// fully login needed
var IS_FULLY_AUTH = ["rest/imports"];
// copy all request params
var COPY_ALL_PROPS = ["OUTPUTFORMAT", "DOWNLOAD"];

// runtime properties. TODO: remove defaults
var isDebug = java.lang.System.getProperty("app.debug");
var urlGeoserver = java.lang.System.getProperty("app.proxy.geoserver") ? 
        java.lang.System.getProperty("app.proxy.geoserver") : "http://sir.dellibertador.gob.cl/geoserver/";
var USERNAME_GEOSERVER = java.lang.System.getProperty("app.proxy.geoserver.username") ?
        java.lang.System.getProperty("app.proxy.geoserver.username") : "admin";
var PASSWORD_GEOSERVER = java.lang.System.getProperty("app.proxy.geoserver.password") ?
        java.lang.System.getProperty("app.proxy.geoserver.password") : "Z6pzh%4R";

/*
 * Geoserver proxy #74477
 */

 var app = exports.app = function(request) {
    var response;
    var url = request.queryParams.url;
    if (url) {
        // Geoserver proxy #74477
        handleGeoserverRequest(request);
    } else {
        response = responseForStatus(400, "Request must contain url parameter.");
    }
    return response;
};

var handleGeoserverRequest = exports.handleGeoserverRequest = function (request){
    
    console.log("Handling " + request.queryParams.url);
    console.log("CONTENT geoserver--->");
    console.log("input: " + request.input);
    var body = request.input.read().decodeToString('utf-8');
    console.log("body: " + body);
    console.log("<--- CONTENT geoserver");

    if (isFullyAuth(request.queryParams.url)){
        var sessionGeoserver = getOpenSession(request);
        var previousCookie = request.headers["Cookie"];

        var responseAuth = getResponseWithSession(request, sessionGeoserver);

        if(!responseAuth.headers["Cookie"]){
            responseAuth = getResponseWithSession(request, geoserverOpenSession(request));
        }
    }

    request.headers.unset("Authorization");
    request.headers.unset("Cookie");

    var response = proxyPass({
        request: request, 
        url: request.queryParams.url
    });

    request.headers["Cookie"] = previousCookie;
    response.headers["Cookie"] = previousCookie;

    return response;
}

function getResponseWithSession(request, openSession){
    //console.log("token --> "+ sessionGeoserver.token);
    var cookie = openSession.token;
    var previousCookie = request.headers["Cookie"]
    request.headers["Cookie"] = cookie + ";Path=/";

    return proxyPass({
        request: request, 
        url: request.queryParams.url
    });
}

// session to connect with geoserver
var sessionOpenned = null;

// private manage of session
function getOpenSession(request){
    if(!sessionOpenned)
        sessionOpenned = geoserverOpenSession(request);

    //TODO: Handle session expire

    return sessionOpenned;
}

function isFullyAuth(url){
    for(var i=0;i<IS_FULLY_AUTH.length; i++){
        if(url.indexOf(IS_FULLY_AUTH[i]) > -1){
            return true;
        }
    }
    return false;
}

// checks if is the geoserver url
exports.isGeoServerURL = function (request){
    var url = request.queryParams.url;
    console.log("URL to proxy? -->" + url);
    console.log("URL to Geoserver ---> " + urlGeoserver);
    if(!!url 
            && url.indexOf(urlGeoserver) == 0        // geserver request
            && (isDebug                          // debug mode not need login
                || !!request.headers["Cookie"])  // is logged
            ){
        for(var i=0;i<URLS_GEOSERVER_NO_PROXIED.length; i++){
            if(url.indexOf(URLS_GEOSERVER_NO_PROXIED[i]) > -1){
                console.log("NOT PROXIED "+url);
                return false;
            }
        }
        console.log("PROXIED: Geoserver request");
        return true;
    }else{
        console.log("NOT PROXIED");
        return false;
    }
}

/**
 * From auth.js
 */
var geoserverOpenSession = exports.authenticateGeoserver = function (request) {
    //console.log("------------- Opening session with geoserver -------");
    var status = 401;
    var token;
    var url = getLoginUrl(request);

    //console.log("Login a "+url +" con "+ USERNAME_GEOSERVER + "/" + PASSWORD_GEOSERVER);
    if (!!USERNAME_GEOSERVER && !!PASSWORD_GEOSERVER) {
        var exchange = clientRequest({
            url: url,
            method: "post",
            async: false,
            data: {
                username: USERNAME_GEOSERVER,
                password: PASSWORD_GEOSERVER
            }
        });
        exchange.wait();
        status = parseStatus(exchange);
        if (status === 200) {
            var cookie = exchange.headers.get("Set-Cookie");
            if (cookie) {
                token = cookie.split(";").shift();
            }
        }
    }
    //console.log("token --> "+token);
    return {
        token: token,
        status: status
    };
};

function getGeoServerUrl(request) {
    var url = java.lang.System.getProperty("app.proxy.geoserver");
    if (url) {
        if (url.charAt(url.length-1) !== "/") {
            url = url + "/";
        }
    } else {
        url = request.scheme + "://" + request.host + (request.port ? ":" + request.port : "") + "/geoserver/";
    }
    return url;
}

function getLoginUrl(request) {
    return getGeoServerUrl(request) + "j_spring_security_check";
}

// get status (ACK!) by parsing Location header
function parseStatus(exchange) {
    var status = 200;
    var location = exchange.headers.get("Location");
    if (/error=true/.test(location)) {
        status = 401;
    }
    return status;
}

exports.getStatus = function(request) {
    var url = getAuthUrl(request);
    var status = 401;
    var headers = new Headers(request.headers);
    var token = headers.get("Cookie");
    var exchange = clientRequest({
        url: url,
        method: "GET",
        async: false,
        headers: headers
    });
    exchange.wait();
    return exchange.status;
};

exports.authenticate = function(request) {
    var params = request.postParams;
    var status = 401;
    var token;
    if (params.username && params.password) {
        var url = getLoginUrl(request);
        var exchange = clientRequest({
            url: url,
            method: "post",
            async: false,
            data: {
                username: params.username,
                password: params.password
            }
        });
        exchange.wait();
        status = parseStatus(exchange);
        if (status === 200) {
            var cookie = exchange.headers.get("Set-Cookie");
            if (cookie) {
                token = cookie.split(";").shift();
            }
        }
    }
    return {
        token: token,
        status: status
    }
};

// /**
//  * From proxy.js
//  */
// var pass = exports.pass = function(config) {
//     if (typeof config == "string") {
//         config = {url: config};
//     }
//     return function(request) {
//         var query = request.queryString;
//         var path = request.pathInfo && request.pathInfo.substring(1) || "";
//         var newUrl = config.url + path + (query ? "?" + query : "");
//         return proxyPass(objects.merge({
//             request: request, 
//             url: newUrl
//         }, config));
//     };
// };

// var getUrlProps = exports.getUrlProps = function(url) {
//     var o, props;
//     try {
//         o = new URL(url);
//     } catch(err) {
//         // pass
//     }
//     if (o) {
//         var username, password;
//         var userInfo = o.getUserInfo();
//         if (userInfo) {
//             // this could potentially be removed if the following ticket is closed
//             // https://github.com/ringo/ringojs/issues/issue/121
//             // but, it could make sense to keep it here as well
//             [username, password] = userInfo.split(":");
//             url = url.replace(userInfo + "@", "");
//         }
//         var port = o.getPort();
//         if (port < 0) {
//             port = null;
//         }
//         props = {
//             url: url,
//             scheme: o.getProtocol(),
//             username: username || null,
//             password: password || null,
//             host: o.getHost(),
//             port: port,
//             path: o.getPath() || "/",
//             query: o.getQuery(),
//             hash: o.getRef()
//         };
//     }
//     return props;
// };

// var createProxyRequestProps = exports.createProxyRequestProps = function(config) {
//     var props;
//     var request = config.request;
//     var url = config.url;
//     var urlProps = getUrlProps(url);
//     if (urlProps) {
//         var headers = new Headers(objects.clone(request.headers));
//         if (!config.preserveHost) {
//             headers.set("Host", urlProps.host + (urlProps.port ? ":" + urlProps.port : ""));
//         }
//         var data = {};
//         var method = request.method;
//         if (method == "PUT" || method == "POST") {
//             if (request.headers.get("content-length")) {
//                 data = request.input;
//             }
//         }

//         for(var key in config.request.queryParams){
//             if(!!key 
//                 && !!config.request.queryParams[key]){
//                 data[key] = config.request.queryParams[key];
//                 //console.log(key+"="+config.request.queryParams[key]);
//             }
//         }

//         props = {
//             url: urlProps.url,
//             method: request.method,
//             scheme: urlProps.scheme,
//             headers: headers,
//             data: data,
//             async: false
//         };

//         if(!!urlProps.username 
//                 && !!urlProps.password){
//             props.username = urlProps.username;
//             props.password = urlProps.password;
//         }
//     }
//     return props;
// };

// function proxyPass(config) {
//     var response;
//     var outgoing = createProxyRequestProps(config);
//     var incoming = config.request;
//     if (!outgoing || outgoing.scheme !== incoming.scheme) {
//         response = responseForStatus(400, "The url parameter value must be absolute url with same scheme as request.");
//     } else {
//         // re-issue request
//         var exchange = clientRequest(outgoing);

//         // for(var key in outgoing){
//         //     console.log(key+"="+outgoing[key]);
//         // }
//     }
//     exchange.wait();
//     var headers = new Headers(objects.clone(exchange.headers));
//     if(!!outgoing.data["DOWNLOAD"] && !!outgoing.data["FILENAME"]){
//         if(outgoing.data["DOWNLOAD"]){
//             headers.unset("Content-Disposition");
//             headers.set("Content-Disposition", "attachment; filename="+ outgoing.data["FILENAME"] +".kml");
//         }
//     }

//     return {
//         status: exchange.status,
//         headers: headers,
//         body: new MemoryStream(exchange.contentBytes)
//     };
// }

var pass = exports.pass = function(config) {
    console.log(config);
    if (typeof config == "string") {
        config = {url: config};
    }
    return function(request) {
        var query = request.queryString;
        var path = request.pathInfo && request.pathInfo.substring(1) || "";
        var newUrl = config.url + path + (query ? "?" + query : "");
        return handleGeoserverRequest(objects.merge({
            request: request, 
            url: newUrl
        }, config));
    };
};

var getUrlProps = exports.getUrlProps = function(url) {
    var o, props;
    try {
        o = new URL(url);
    } catch(err) {
        // pass
    }
    if (o) {
        var username, password;
        var userInfo = o.getUserInfo();
        if (userInfo) {
            // this could potentially be removed if the following ticket is closed
            // https://github.com/ringo/ringojs/issues/issue/121
            // but, it could make sense to keep it here as well
            [username, password] = userInfo.split(":");
            url = url.replace(userInfo + "@", "");
        }
        var port = o.getPort();
        if (port < 0) {
            port = null;
        }
        props = {
            url: url,
            scheme: o.getProtocol(),
            username: username || null,
            password: password || null,
            host: o.getHost(),
            port: port,
            path: o.getPath() || "/",
            query: o.getQuery(),
            hash: o.getRef()
        };
    }
    return props;
};

var createProxyRequestProps = exports.createProxyRequestProps = function(config) {
    var props;
    var request = config.request;
    var url = config.url;
    var urlProps = getUrlProps(url);
    if (urlProps) {
        var headers = new Headers(objects.clone(request.headers));
        if (!config.preserveHost) {
            headers.set("Host", urlProps.host + (urlProps.port ? ":" + urlProps.port : ""));
        }
        // if (!config.allowAuth) {
        //     // strip authorization and cookie headers
        //     headers.unset("Authorization");
        //     headers.unset("Cookie");
        // }
        var data;
        var method = request.method;
        if (method == "PUT" || method == "POST") {
            if (request.headers.get("content-length")) {
                data = request.input;
                //console.log(data);
            }
        }
        if(data.length > 0){
            console.log("Data > 0");
        }

        // check if must be copied all url props
        data = checkAndCopyData(config, data);

        props = {
            url: urlProps.url,
            method: request.method,
            scheme: urlProps.scheme,
            username: PASSWORD_GEOSERVER,
            password: PASSWORD_GEOSERVER,
            headers: headers,
            data: data
        };
    }
    return props;
};

// copy all urlProps to data if is marked to be copied
function checkAndCopyData(config, data){
    var copyAll = false;
    for(var i=0;i<COPY_ALL_PROPS.length; i++){
        if(!!config.request.queryParams[COPY_ALL_PROPS[i]]){
            copyAll = true;
            break;
        }
    }
    if(copyAll){
        // init data
        if(!data){
            data = {};
        }

        console.log("------- Query parameters ---------");
        for(var key in config.request.queryParams){
            if(!!key 
                && !!config.request.queryParams[key]){
                data[key] = config.request.queryParams[key];
                console.log(key+"="+config.request.queryParams[key]);
            }
        }
        console.log("------- EoF query parameters ---------");
    }

    return data;
}

function proxyPass(config) {
    console.log("ProxyPass Geoserver");
    var response;
    var outgoing = createProxyRequestProps(config);
    var incoming = config.request;
    if (!outgoing || outgoing.scheme !== incoming.scheme) {
        response = responseForStatus(400, "The url parameter value must be absolute url with same scheme as request.");
    } else {
        // re-issue request
        var exchange = clientRequest({
            url: outgoing.url,
            method: outgoing.method,
            username: USERNAME_GEOSERVER,
            password: PASSWORD_GEOSERVER,
            headers: outgoing.headers,
            data: outgoing.data,
            async: false
        });
    }
    exchange.wait();
    var headers = new Headers(objects.clone(exchange.headers));
    if (!config.allowAuth) {
        // strip out authorization and cookie headers
        headers.unset("WWW-Authenticate");
        headers.unset("Set-Cookie");
    }
    // for layer download/export
    if(!!outgoing.data
        && !!outgoing.data["DOWNLOAD"] 
        && !!outgoing.data["FILENAME"]){
        if(outgoing.data["DOWNLOAD"]){
            headers.unset("Content-Disposition");
            headers.set("Content-Disposition", "attachment; filename="+ outgoing.data["FILENAME"] +".kml");
        }
    }
    return {
        status: exchange.status,
        headers: headers,
        body: new MemoryStream(exchange.contentBytes)
    };
}
