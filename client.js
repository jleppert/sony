var request = require('request');

var live = document.createElement('canvas'), liveCtx = live.getContext('2d');

document.body.appendChild(live);
var url = document.location.href + 'camera';
request({ url: url, method: 'POST', body: JSON.stringify({
  method: 'startLiveview',
  params: [],
  id: 1,
  version: '1.0'
})}, function(err, res, body) {
  var COMMON_HEADER_SIZE = 8,
      PAYLOAD_HEADER_SIZE = 128,
      JPEG_SIZE_POSITION = 4,
      PADDING_SIZE_POSITION = 7,
      jpegSize = 0,
      paddingSize = 0,
      bufferIndex = 0;
  
  //console.log('got start liveview response, making request', liveViewUrl);
 function toHex(d) {
       return  ("0"+(Number(d).toString(16))).slice(-2).toUpperCase()
 }
  var liveviewUrl = document.location.href + 'liveview'; 
  request({ url: liveviewUrl, method: 'GET' }).on('response', function(res) {
    var imageBuffer;

    var buffer = Buffer.alloc ? Buffer.alloc(0) : new Buffer(0), jpegBuffer = new Buffer(0);

    var sequenceNumber, timestamp, jpegByteLength;
    res.on('data', function(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      
      var startIndex = buffer.indexOf(255), liveViewPayloadIndex = buffer.indexOf(1);

      if(startIndex !== -1 && liveViewPayloadIndex !== -1) {
        if(liveViewPayloadIndex === (startIndex + 1)) {
          
          sequenceNumber = buffer.readUIntBE(startIndex + 2, 2);
          timestamp = buffer.readUIntBE(startIndex + 4, 4);
        }

        if(buffer.length >= (COMMON_HEADER_SIZE + PAYLOAD_HEADER_SIZE)) {
          var startCode = toHex(buffer.readUIntBE(startIndex + 8, 4));
          if(startCode === '24' || startCode === '35' || startCode === '68' || startCode === '79') {
            var headerStartIndex = startIndex + 8;
            
            if(buffer[liveViewPayloadIndex] === 1) {
              jpegByteLength = buffer.readUIntBE(headerStartIndex + 4, 3),
              paddingByteLength = buffer[headerStartIndex + 7];
              jpegBuffer = new Buffer(jpegByteLength);
            } else {
              jpegByteLength = 0;
              paddingByteLength = 0;
            }
          }
          
          if(jpegByteLength > 0) {
            if(buffer.length >= (COMMON_HEADER_SIZE + PAYLOAD_HEADER_SIZE + jpegByteLength + paddingByteLength)) {
              buffer.copy(jpegBuffer, 0, headerStartIndex + 128, headerStartIndex + 128 + jpegByteLength);
              
              var frame = new Image(), blobURL;
              frame.onload = function() {
                liveCtx.drawImage(frame, 0, 0);
                URL.revokeObjectURL(blobURL);
              }

              var blob = new Blob([jpegBuffer], { type: 'image/jpeg' });
              blobURL = URL.createObjectURL(blob);
              frame.src = blobURL;

              buffer = new Buffer(0);
              jpegByteLength = 0;
              paddingByteLength = 0;
            }
          } else {
            buffer = new Buffer(0);
          }
        }
      }
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

