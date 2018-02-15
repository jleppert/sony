 var Client = require('node-ssdp').Client, client = new Client();

client.on('response', function (headers, statusCode, rinfo) {
  console.log('Got a response to an m-search.', headers, statusCode, rinfo);
});
client.search('urn:schemas-sony-com:service:ScalarWebAPI:1');
setTimeout(function() {
  console.log('done');
}, 5000);
