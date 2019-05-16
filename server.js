// direct-reader.node
// An app which can be set to read directly from a Galera node,
// bypassing the hostname supplied by a CF binding.

// NOTE: To run in local mode, provide a VCAP_SERVICES env variable like this:
// VCAP_SERVICES={"p-mysql":[{"credentials":{"uri":"mysql://user:password@127.0.0.1/latticeDB"}}]}

var finalhandler = require('finalhandler') ;
var http = require('http') ;
var serveStatic = require('serve-static') ;
var strftime = require('strftime') ;
var time = require('time') ;
var url = require('url') ;
var util = require('util') ;
var mysql = require('mysql') ;
var fs = require('fs') ;

// Variables
var data = "" ;
var activateState = Boolean(false) ;
mysql_data_service = undefined ;
var mysql_creds = {} ;
var vcap_services = undefined ;
var dbClient = undefined ;
var dbConnectState = Boolean(false) ;
var dbConnectTimer = undefined ;

// Setup based on Environment Variables
if (process.env.VCAP_SERVICES) {
    vcap_services = JSON.parse(process.env.VCAP_SERVICES) ;
    if (vcap_services['p.mysql']) {
        mysql_data_service = "p.mysql" ;
    }
    if (vcap_services["p-mysql"]) {
        mysql_data_service = "p-mysql" ;
    }
    if (mysql_data_service) {
        mysql_creds["host"] = vcap_services[mysql_data_service][0]["credentials"]["hostname"] ;
        mysql_creds["user"] = vcap_services[mysql_data_service][0]["credentials"]["username"] ;
        mysql_creds["password"] = vcap_services[mysql_data_service][0]["credentials"]["password"] ;
        mysql_creds["port"] = 3306 ;
        mysql_creds["database"] = "service_instance_db" ;
        // mysql_creds["port"] = vcap_services[mysql_data_service][0]["credentials"]["port"] ;
        // mysql_creds["database"] = vcap_services[mysql_data_service][0]["credentials"]["name"] ;
        if (vcap_services[mysql_data_service][0]["credentials"]["tls"]) {
            mysql_creds["ca_certificate"] = vcap_services[mysql_data_service][0]["credentials"]["tls"]["cert"]["ca"];
        } else {
            mysql_creds["ca_certificate"] = undefined ;
        }
        pm_uri = vcap_services[mysql_data_service][0]["credentials"]["uri"] ;
        util.log("Got access credentials to " + mysql_data_service + " database") ;
        activateState="mysql" ;
    }
}

if (process.env.VCAP_APP_PORT) { var port = process.env.VCAP_APP_PORT ;}
else { var port = 8080 ; }
if (process.env.CF_INSTANCE_INDEX) { var myIndex = JSON.parse(process.env.CF_INSTANCE_INDEX) ; }
else { myIndex = 0 ; }
var myInstance = "Instance_" + myIndex + "_Hash" ;

function setupSchema(response) {
    dbClient.query("show tables LIKE 'SampleData'", function(err, results, fields) {
        if (err) {
            console.error(err) ;
            process.exit(1) ;
        } else {
            if (0 == results.length) {
                util.log("Setting up schema.") ;
                dbClient.query("create table SampleData (K VARCHAR(20), V VARCHAR(20))",
                               function (err, results, fields) {})
            } else {
                util.log("SampleData table already exists.") ;
            }
            if (response !== undefined) {
                response.writeHead(302, {'Location': '/show-table.html'}) ;
                response.end()
            }                
        }
    }) ;
}
    
// Callback functions

function handleDBerror(err, response) {
    if (dbConnectState) {
        console.error("Issue with database, " + err.code + ". Attempting to reconnect every 1 second.")
        dbConnectState = false ;
        dbClient.destroy() ;
        setTimeout(MySQLConnect, 1000) ;
    }
    if (response !== undefined) {
        response.end("ERROR getting values: " + err) ;
    }
}

function handleDBConnect(err, response) {
    if (err) {
        dbConnectState = false ;
        console.error("ERROR: problem connecting to DB: " + err.code +
                      ", will try again every 1 second.") ;
        dbConnectTimer = setTimeout(MySQLConnect, 1000) ;
    } else {
        dbClient.on('error', handleDBerror) ;
        console.log("Connected to database.") ;
        dbConnectState = true ;
        if (dbConnectTimer) {
            clearTimeout(dbConnectTimer) ;
            dbConnectTimer = undefined ;
        }
        setupSchema(response) ;
    }
}

function handleDBping(request, response, err) {
    if (err) {
        util.log("MySQL Connection error: " + err) ;
        response.end("MySQL connection error: " + err) ;
        dbClient.destroy() ;
        MySQLConnect() ;
    } else {
        response.end("MySQL ping successful.") ;
    }
}

// Helper functions

function doPing(request, response) {
    dbClient.ping(function (err) {
        handleDBping(request, response, err) ;
    }) ;
}

function doStatus(request, response) {
    dbClient.query("SHOW STATUS LIKE 'Ssl_version'", function (err, results, fields) {
        if (err) {
            handleDBerror(err, response) ;
        } else {
            response.end(JSON.stringify({"dbStatus": dbConnectState,
                                         "tls-cipher": results[0]["Value"]}))
        };
    }) ;
}

function MySQLConnect(response) {
    if (activateState) {
        clientConfig = {
            host : mysql_creds["host"],
            user : mysql_creds["user"],
            password : mysql_creds["password"],
            port : mysql_creds["port"],
            database : mysql_creds["database"]
        } ;
        if (mysql_creds["ca_certificate"]) {
            console.log("CA Cert detected; using TLS");
            clientConfig["ssl"] = { ca : mysql_creds["ca_certificate"] } ;
        }
        dbClient = mysql.createConnection( clientConfig ) ;
        dbClient.connect(function (err, results, fields) {
            handleDBConnect(err, response)
        }) ;
    } else {
        dbClient = undefined ;
    }
}

function sql2json(request, response, error, results, fields) {
    if (error) {
        handleDBerror(error, response) ;
    } else {
        var dataSet = [] ;
        for (var kv in results) {
            dataSet.push( [ results[kv]['K'], results[kv]['V'] ] ) ;
        }
        response.end(JSON.stringify(dataSet)) ;
    }
}

function handleWriteRequest(request, response, error, results, fields) {
    if (error) { handleDBerror(error, response) }
    else {
        console.log("Write completed. Sending browser back to where it came from: " + request.headers["referer"]) ;
        response.writeHead(302, {'Location': request.headers["referer"]}) ;
        response.end()
    }
    return(true) ;
}

    
function errorDbNotReady(response) {
    response.end(JSON.stringify({"dbStatus": dbConnectState})) ;
}

function readTable(request, response, table, callBack) {
    if (dbConnectState) {
        dbClient.query('SELECT K, V from ' + table,
                       function (error, results, fields) {
                           callBack(request, response, error, results, fields) ;
                       }) ;
    } else {
        errorDbNotReady(response) ;
    }
}

function writeSomething(request, response, key) {
    if (dbConnectState) {
        var timeStamp = strftime("%Y-%m-%d %H:%M") ;
        var sql = "insert into SampleData VALUES ('" + key + "','" + timeStamp + "')" ;
        console.log("SQL: " + sql ) ;
        dbClient.query(sql, function (error, results, fields) {
            handleWriteRequest(request, response, error, results, fields) ;
        }) ;
    } else {
        errorDbNotReady(response) ;
    }
}

function dispatchApi(request, response, method, query) {
    console.log("... " + method) ;
    switch (method) {
    case "dbstatus":
        if (dbConnectState) {
            doStatus(request, response) ;
        } else {
            response.end(JSON.stringify(false)) ;
        }
        break ;
    case "read":
        if (query["table"]) {
            util.log("Received request to read table: " + query["table"]) ;
            readTable(request, response, query["table"], sql2json) ;
        } else {
            response.end("ERROR: Usage: /json/read?table=name"
                         + " (request: " + request.url + ")") ;
        }
        break ;
    case 'instanceNum':
        response.end(JSON.stringify(myIndex)) ;
        break ;
    default:
        response.writeHead(404) ;
        response.end(false) ;
    }
    
}

function requestHandler(request, response) {
    var data = "" ;
    // console.log("Got headers: " + JSON.stringify(request.headers)) ;
    requestParts = url.parse(request.url, true) ;
    rootCall = requestParts["pathname"].split('/')[1] ;
    console.log("Recieved request for: " + rootCall) ;
    switch (rootCall) {
    case "env":
	      if (process.env) {
	          data += "<p>" ;
		        for (v in process.env) {
		            data += v + "=" + process.env[v] + "<br>\n" ;
		        }
		        data += "<br>\n" ;
	      } else {
		        data += "<p> No process env? <br>\n" ;
	      }
        response.end(data) ;
        break ;
    case "json":
        var method = requestParts["pathname"].split('/')[2] ;
        dispatchApi(request, response, method, requestParts["query"]) ;
        return(true) ;
        break ;
    case "dbstatus":
        if (dbConnectState) {
            doStatus(request, response) ;
        } else {
            data += "I'm sorry, Dave, I can't do that. No connection to database." ;
            response.end(data) ;
        }
        break ;
    case "ping":
        if (dbConnectState) {
            doPing(request, response) ;
        } else {
            data += "I'm sorry, Dave, I can't do that. No connection to database." ;
            response.end(data) ;
        }
        break ;
    case "write":
        if (requestParts["query"]["key"]) {
            util.log("Received request to write key: " + requestParts["query"]["key"]) ;
            writeSomething(request, response, requestParts["query"]["key"]) ;
        } else {
            response.end("ERROR: Usage: /write?key=foo"
                         + "(request: " + request.url  + ")") ;
        }
        return(true) ;
        break ;
    case "useDB":
        if (requestParts["query"]) {
            console.log("Received DB connection info: " + requestParts["query"]["IP"]) ;
            mysql_creds["host"] = requestParts["query"]["IP"] ;
            mysql_creds["database"] = requestParts["query"]["DB"] ;
            mysql_creds["user"] = requestParts["query"]["user"] ;
            mysql_creds["password"] = requestParts["query"]["password"] ;
            MySQLConnect(response) ;
        } else {
            response.end("ERROR: Usage: /useDB?key=foo"
                         + "(request: " + request.url  + ")") ;
        }
        return(true) ;
        break ;
    default:
        response.writeHead(404) ;
        response.end("404 - not found") ;
    }
}

// MAIN

var staticServer = serveStatic("static") ;
monitorServer = http.createServer(function(req, res) {
    var done = finalhandler(req, res) ;
    staticServer(req, res, function() {requestHandler(req, res, done)}) ;
}) ;

monitorServer.listen(port) ;

console.log("Waiting to connect to DB.") ;
console.log("Server up and listening on port: " + port) ;
