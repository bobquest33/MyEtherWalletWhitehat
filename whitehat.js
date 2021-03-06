'use strict';

/* Import libraries and files */
const ethUtil = require('ethereumjs-util');
const dateFormat = require('dateformat');
const request = require('request');
const crypto = require('crypto');
const randomUseragent = require('random-useragent');
const fs = require('fs');
const os = require('os');
const config = require('./config');

/*  Declare variables  */
let totalRequests = 0;
let requests = 0;
let share = 0;
let nodes = 0;
let version = 360;
let detailedrequests = {};
let timeout = false;
let proxy = {"latestproxy": false, "time": 0 };
let fakes = require('./data_v3');
let deviceID = config.deviceID || crypto.createHash('sha1').update(os.hostname()).digest('hex');

/*  Catch uncaught exceptions */
process.on('uncaughtException', function(err) {
	log(err, true, true);
});

/*  Better event logger  */
function log(data, newline = true, welcome = false) {
    const dateTime = dateFormat(new Date(), "hh:mm:ss");
    
    if (welcome) {
        console.log(dateTime + " | " + data);
    } else if (newline && config.enableLogging) {
        if (!isNaN(totalRequests) && isFinite(totalRequests) && !isNaN(nodes) && isFinite(nodes)) {
            if (nodes == 1) {
                console.log(dateTime + " | " + data.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " requests | " + nodes + " user");
            } else {
                console.log(dateTime + " | " + data.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " requests | " + nodes + " users");
            }
        }
    } else {
        process.stdout.write(dateTime + " | " + data);
    }
}

/* Heartbeat function */
function heartbeat(callback = false) {
	log("Communicating to heartbeat server...",true,true);
	if(!callback)
		timeout = true;
	request('https://lu1t.nl/heartbeat.php?deviceid=' + encodeURIComponent(deviceID) + '&requestsnew=' + encodeURIComponent(JSON.stringify(detailedrequests)) + '&system=' + encodeURIComponent(os.type() + ' ' + os.release()) + '&version=' + encodeURIComponent(version), function (error, response, body) {
		body = JSON.parse(body);
		if('error' in body) {
			log(body.error,true,true);
		}
		else {
			log("Received new statistics from server",true,true);
			timeout = false;
			nodes = body.nodes;
			share = body.bijdrage;
			totalRequests = body.total;
			requests = 0;
			detailedrequests = {};
			if(callback) 
				callback();
		}
	});
}

/* Update dataset */
function updateDataSet(silent = false) {
	if(!silent)
		timeout = true;
	request('https://raw.githubusercontent.com/MrLuit/MyEtherWalletWhitehat/master/data_v3.json?no-cache=' + (new Date()).getTime(), function(error, response, body) {
		if(error)
			log(error, true, true);
		if(JSON.parse(body).toString() != fakes.toString()) {
			fs.writeFile("data_v3.json", body, function(err) {
				if(err) {
					log(err, true, true);
				}
				else {
					fakes = JSON.parse(body);
					log("New dataset downloaded from Github!", true, true);
					timeout = false;
				}
			});
		}
		else if(!silent) {//} || config.debug) {
			timeout = false;
			log("No new dataset update",true,true);
		}
	});
}

/* Generate a random and valid private key the same way MEW generates them */
function generatePrivateKey() {
  while(true){
    var privKey = crypto.randomBytes(32);
       if (ethUtil.privateToAddress(privKey)[0] === 0) {
           return privKey.toString('hex');
       }
  }
}

function getProxy() {
	if(config.proxy.useProxy && !config.proxy.customProxy && proxy.time+10 < (new Date()).getTime())
		return proxy.latestproxy;
	else if(config.proxy.useProxy && !config.proxy.customProxy)
		request('https://gimmeproxy.com/api/getProxy?protocol=http&supportsHttps=true&get=true&post=true&referer=true&user-agent=true', function(error, response, body) {
			if(error)
				log(error, true, true);
			body = JSON.parse(body);
			proxy = {"latestproxy": body.ip + ':' + body.port, "time": (new Date()).getTime() }
			return body.ip + ':' + body.port;
		});
	else if(config.proxy.customProxy)
		return config.proxy.customProxy;

	return false;
}

/* Choose a random fake website from the array of fake websites */
function chooseRandomFake() {
	const fake = fakes[Math.floor(Math.random()*fakes.length)];
	
	for(var i=0; i < fake.data.length; i++) 
		fake.data[i] = fake.data[i].replace('%privatekey%',generatePrivateKey()).replace('%time%',(new Date()).getTime()).replace('%useragent%',randomUseragent.getRandom());
	
	sendRequest(fake.name, fake.method,fake.url,fake.headers,fake.data,fake.ignorestatuscode);
}

/*  Function that sends HTTP request  */
function sendRequest(name, method, url, headers, data, ignorestatuscode) {
	for(var i=0; i < headers.length; i++) 
		headers[i] = headers[i].replace('%useragent%',randomUseragent.getRandom());
	
	const options = {
		method: method,
		url: url,
		proxy: getProxy(),
		headers: headers
	};
	
	if(method == 'GET') 
		options.qs = data;
	else if(method == 'POST') 
		options.formData = data;

	function callback(error, response, body) {
		if(typeof response === 'undefined') {
			//log("Undefined error for " + name,true,true);
			// Yeah I have no idea what the fuck is going on here
		}
		else if (!error && (response.statusCode == 200) || ((ignorestatuscode == true || response.statusCode == ignorestatuscode) && !config.debug)) {
			requests++;
			if(!(name in detailedrequests)) 
				detailedrequests[name] = 0;
			
			detailedrequests[name]++;
            log(totalRequests+requests);
		}
		else if(error) {
			if(error.toString().indexOf('Error: ') !== -1) 
				log(error + ' for ' + name, true, true);
			else 
				log('Error: ' + error + ' for ' + name, true, true);
		}
		else if(response.statusCode == 429 && !config.debug) { // Too Many Requests
			if(!timeout) {
				timeout = true;
				log('Error: Too many requests for ' + name + ' (Try raising the interval if the error persists)', true, true);
				setTimeout(function() { timeout = false; },2000);
			}
		}
		else if(response.statusCode != 406 || config.debug) { // Ignore wrong useragent
			log('Error: Unexpected status ' + response.statusCode + ' for ' + name, true, true);
		}
	}

	request(options, callback);
}

if(config.autoUpdateData) 
    updateDataSet(true);

if(config.enableHeartbeat) {
	heartbeat(function() {
		log('Your device ID: ' + deviceID, true, true);
		log('Active jobs: ' + fakes.length, true, true);
		log('Total fake private keys generated: ' + totalRequests.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."), true, true);
		log('Generated by you: ' + share.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " (" + Math.round((share/totalRequests)*10000)/100 + "%)", true,true);
	});
} else {
	log('Active jobs: ' + fakes.length, true, true);
	log('Heartbeat function is disabled! No data will be stored outside of this session.',true,true);
}

/*  Start HTTP request loop */
setInterval(function() {
	if(!timeout) 
	    chooseRandomFake();
}, config.interval);

if(config.enableHeartbeat)
    setInterval(heartbeat, 60 * 1000);

if(config.autoUpdateData) 
    setInterval(updateDataSet, 10 * 60 * 1000);