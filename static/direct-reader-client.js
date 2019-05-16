// Direct Read Client - code to access the direct-reader server

var dbStatus = undefined ;
var instanceNum = undefined ;

function getQueryVariable(variable) {
    var query = window.location.search.substring(1);
    var vars = query.split("&");
    for (var i=0;i<vars.length;i++) {
        var pair = vars[i].split("=");
        if(pair[0] == variable){return pair[1];}
    }
    return(false);
}

function getDBstatus(displayData, instance) {
    var url = document.baseURI + "json/dbstatus" ;
    var request = new XMLHttpRequest() ;
    if (displayData === undefined) displayData = true ;
    if (instance === undefined) instance = 0 ;
    request.onload = function () {
        if (200 == request.status) {
            q = JSON.parse(request.responseText) ;
            dbStatus = q.dbStatus ;
            displayDBstatus() ;
            if (displayData) { getCurrentData() ; }
        }
    } ;
    console.log("Requestion DB status from: " + JSON.stringify(instance)) ;
    request.open("GET", url) ;
    request.setRequestHeader("X-CF-APP-INSTANCE", instance) ;
    request.send(null) ;
}

function displayDBstatus() {
    var span = document.getElementById("dbstatus") ;
    span.innerHTML = dbStatus ;
}

function getInstanceNum() {
    if (instanceNum === undefined) {
        var url = document.baseURI + "json/instanceNum" ;
        var request = new XMLHttpRequest() ;
        request.onload = function () {
            if (200 == request.status) {
                instanceNum = request.responseText ;
                displayInstanceNum() ;
            }
        }
        request.open("GET", url) ;
        request.send(null) ;
    } else {
        displayInstanceNum() ;
    }
}

function displayInstanceNum() {
    var iNumSpan = document.getElementById("instanceNum") ;
    iNumSpan.innerHTML = instanceNum ;
}

function getCurrentData() {
    if (dbStatus) {
        var url = document.baseURI + "json/read?table=SampleData" ;
        var request = new XMLHttpRequest() ;
        request.onload = function () {
            if (200 == request.status) {
                // console.log("Got data: " + JSON.stringify(request.response)) ;
                displayDBdata(JSON.parse(request.responseText)) ;
            } else {
                console.log("Failed to get data from server.") ;
            }
        }
        request.open("GET", url) ;
        request.send(null) ;
    } else {
        console.log("dbStatus not true, not loading data: " + dbStatus) ;
    }
}

function displayDBdata(data) {
    var item ;
    var dataTable = document.getElementById("dataBody") ;
    while (dataTable.lastChild) {
        dataTable.removeChild(dataTable.lastChild) ;
    }
    for (i = 0 ; i < data.length ; i++) {
        var newTR = document.createElement("TR") ;
        var keyTD = document.createElement("TD") ;
        var valTD = document.createElement("TD") ;
        keyTD.appendChild(document.createTextNode(data[i][0])) ;
        valTD.appendChild(document.createTextNode(data[i][1])) ;
        newTR.appendChild(keyTD) ; newTR.appendChild(valTD) ;
        dataTable.insertBefore(newTR, dataTable.firstChild) ;
    }
}
