var COMMON_HEADER_SIZE = 8, PAYLOAD_HEADER_SIZE = 128;

function toHex(d) {
  return ('0'+(Number(d).toString(16))).slice(-2).toUpperCase();
}

function decoder(frameCb) {
  var buffer     = Buffer.alloc ? Buffer.alloc(0) : new Buffer(0), 
      jpegBuffer = new Buffer(0),
      seq, timestamp, jpegByteLength = 0, startIndex = -1, liveViewPayloadIndex = -1;

  return {
    chunk: function(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if(startIndex === -1 || liveViewPayloadIndex === -1) {
        for(var i = 0; i < buffer.length; i++) {
          if(i + 1 < buffer.length && buffer[i] === 255 && buffer[i+1] === 1) {
            startIndex = i;
            liveViewPayloadIndex = i + 1;
          }
        }
      }
      if(startIndex !== -1 && liveViewPayloadIndex !== -1) {
        if(buffer.length < startIndex + 8) return;
        seq = buffer.readUIntBE(startIndex + 2, 2);
        timestamp = buffer.readUIntBE(startIndex + 4, 4);

        if(buffer.length >= (startIndex + COMMON_HEADER_SIZE + PAYLOAD_HEADER_SIZE)) {
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
          } else {
            console.error('Invalid start code', startCode);
            buffer = new Buffer(0);
            jpegByteLength = 0;
            paddingByteLength = 0;
            startIndex = -1;
            liveViewPayloadIndex = -1;
          }
          
          if(jpegByteLength > 0) {
            if(buffer.length >= (startIndex + COMMON_HEADER_SIZE + PAYLOAD_HEADER_SIZE + jpegByteLength + paddingByteLength)) {
              buffer.copy(jpegBuffer, 0, headerStartIndex + 128, headerStartIndex + 128 + jpegByteLength);
              frameCb(seq, timestamp, jpegBuffer);
              buffer = new Buffer(0);
              jpegByteLength = 0;
              paddingByteLength = 0;
              startIndex = -1;
              liveViewPayloadIndex = -1;
            }
          }
        }
      }
    }
  };
}

module.exports = decoder;
