var request = require('request'), 
    fs      = require('fs'),
    browserify = require('browserify-middleware'),
    path = require('path'),
    express = require('express');

var url = 'http://192.168.122.1:8080/sony/camera';

var app = express();

app.use('/client.js', browserify(path.join(__dirname, 'client.js')));

app.use('/camera', function(req, res) {
  req.pipe(request(url + req.url)).pipe(res);
});

var liveviewUrl = 'http://192.168.122.1:8080/liveview/liveviewstream';
app.use('/liveview', function(req, res) {
  req.pipe(request(liveviewUrl)).pipe(res);
});

app.get('/live', function(req, res) {
  request({ url: url, method: 'POST', body: JSON.stringify({
    method: 'startLiveview',
    params: [],
    id: 1,
    version: '1.0'
  })}, function(err, res, body) {
    var liveViewUrl = JSON.parse(body).result[0],
        COMMON_HEADER_SIZE = 8,
        PAYLOAD_HEADER_SIZE = 128,
        JPEG_SIZE_POSITION = 4,
        PADDING_SIZE_POSITION = 7,
        jpegSize = 0,
        paddingSize = 0,
        bufferIndex = 0;
    
    console.log('got start liveview response, making request', liveViewUrl);
    res.status(200);
    request({ url: liveViewUrl, method: 'GET' }).on('response', function(res) {
      var imageBuffer;

      var buffer = Buffer.alloc ? Buffer.alloc(0) : new Buffer(0);
      console.log('got live view response');

      res.on('data', function(chunk) {
        if (jpegSize === 0) {
          buffer = Buffer.concat([buffer, chunk]);

          if (buffer.length >= (COMMON_HEADER_SIZE + PAYLOAD_HEADER_SIZE)) {
            jpegSize =
              buffer.readUInt8(COMMON_HEADER_SIZE + JPEG_SIZE_POSITION) * 65536 +
              buffer.readUInt16BE(COMMON_HEADER_SIZE + JPEG_SIZE_POSITION + 1);

            imageBuffer = Buffer.alloc ? Buffer.alloc(jpegSize) : new Buffer(jpegSize);

            paddingSize = buffer.readUInt8(COMMON_HEADER_SIZE + PADDING_SIZE_POSITION);

            buffer = buffer.slice(8 + 128);
            if (buffer.length > 0) {
              buffer.copy(imageBuffer, bufferIndex, 0, buffer.length);
              bufferIndex += buffer.length;
            }
          }
        } else {
          chunk.copy(imageBuffer, bufferIndex, 0, chunk.length);
          bufferIndex += chunk.length;

          if (chunk.length < jpegSize) {
            jpegSize -= chunk.length;
          } else {
            console.log('frame!!');
            res.send(imageBuffer);
            //self.emit('liveviewJpeg', imageBuffer);
            buffer = chunk.slice(jpegSize + paddingSize);
            jpegSize = 0;
            bufferIndex = 0;
          }
        }
        console.log('got data', chunk.length);
      });

      res.on('close', function() {
        console.log('close');
      });

      res.on('error', function(e) {
        console.log('error', e);
      });
    });
    //console.log(err, body, url);
    //var result = JSON.parse(body);
    //console.log(result);
    //fs.writeFileSync('./output.json', JSON.stringify(result));
  });
});

app.use(express.static('static'));
app.listen(3000);
