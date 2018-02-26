var zerorpc = require('zerorpc'),
    client  = new zerorpc.Client();

client.connect('tcp://127.0.0.1:4242');

client.on('error', function(error) {
  console.log('rpc error', error);
});

client.invoke('ping', 'hello world', function(err, res, more) {
  console.log('got result', err, res);
});
