var clientRequest = require("ringo/httpclient").request;
var Headers = require("ringo/utils/http").Headers;
var MemoryStream = require("io").MemoryStream;
var objects = require("ringo/utils/objects");

var isDebug = java.lang.System.getProperty("app.debug");

var URL = java.net.URL;

var app = exports.app = function(request) {
    var response;
    var url = request.queryParams.url;
    if (url) {

        if(isDebug){
            console.log("Proxing --> " + url);
        }

        response = proxyPass({
            request: request, 
            url: url
        });

    } else {
        response = responseForStatus(400, "Request must contain url parameter.");
    }
    return response;
};

var pass = exports.pass = function(config) {
    //console.log("pass");
    if (typeof config == "string") {
        config = {url: config};
    }
    return function(request) {
        var query = request.queryString;
        var path = request.pathInfo && request.pathInfo.substring(1) || "";
        var newUrl = config.url + path + (query ? "?" + query : "");
        return proxyPass(objects.merge({
            request: request, 
            url: newUrl
        }, config));
    };
};

var getUrlProps = exports.getUrlProps = function(url) {
    //console.log("getUrlProps");
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
    if(isDebug){
        // console.log("************************************  createProxyRequestProps");
        // console.log("***************config*************");
        // showParams(config);
        // console.log("***************request*************");
        // showParams(config.request);
        // console.log("***************request.postParams*************");
        // showParams(config.request.postParams);
        // console.log("***************request.queryParams*************");
        // showParams(config.request.queryParams);
    }
    var props;
    var request = config.request;
    var url = config.url;
    var urlProps = getUrlProps(url);
    if (urlProps) {
        var headers = new Headers(objects.clone(request.headers));
        if (!config.preserveHost) {
            headers.set("Host", urlProps.host + (urlProps.port ? ":" + urlProps.port : ""));
        }
        if (!config.allowAuth) {
            // strip authorization and cookie headers
            headers.unset("Authorization");
            headers.unset("Cookie");
        }
        var method = request.method;
        var data = obtainData(request, method);
        props = {
            url: urlProps.url,
            method: request.method,
            scheme: urlProps.scheme,
            username: urlProps.username,
            password: urlProps.password,
            headers: headers,
            data: data
        };
    }
    if(isDebug){
        // console.log("************************************  EoF createProxyRequestProps");
    }
    return props;
};

function obtainData (request, method){
    var data;
    if (method == "PUT") { // put PUT request.input
        if (request.headers.get("content-length")) {
            data = request.input;
        }
    }else if(method == "POST"){ // POST can use postParams || request.input
        if(!!request.postParams){
            data = request.postParams
        }else if (request.headers.get("content-length")) {
            data = request.input;   
        }
    }else if(method == "GET"){ // GET can use queryParams || request.input
        if(!!request.queryParams){ 
            data = request.queryParams
        }else if (request.headers.get("content-length")) {
            data = request.input;   
        }
    } 

    if(data.url) {
        // Prevents url from being passed as parameter.        
        delete data.url;
    }

    return data;
}

function proxyPass(config) {
    if(isDebug){
        console.log("************************************ proxyPass ************************************");
    }
    var response;
    var outgoing = createProxyRequestProps(config);
    var incoming = config.request;
    if (!outgoing || outgoing.scheme !== incoming.scheme) {
        response = responseForStatus(400, "The url parameter value must be absolute url with same scheme as request.");
    } else {
        if(isDebug){
            console.log("*************** outgoing -->");
            showParams(outgoing);
            console.log("*************** outgoing.data -->");
            showParams(outgoing.data);
        }

        // re-issue request
        var exchange = clientRequest({
            url: outgoing.url,
            method: outgoing.method,
            username: outgoing.username,
            password: outgoing.password,
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
    if(isDebug){
        console.log("**********************************  EoF proxyPass **********************************");
    }
    return {
        status: exchange.status,
        headers: headers,
        body: new MemoryStream(exchange.contentBytes)
    };
}

var showParams = exports.showParams =  function (keyValues){
    for(var key in keyValues){
             if(!!key 
                && !!keyValues[key]){
                //data[key] = config.request.queryParams[key];
                console.log(key+"="+keyValues[key]);
            }
        }
}
