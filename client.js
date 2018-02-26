var request = require('request'),
    dnode   = require('dnode'),
    shoe    = require('shoe'),
    consts  = require('./consts'),
    decoder = require('./liveviewDecoder');

var container = document.createElement('div'),
    previewsContainer = document.createElement('div'),
    live      = document.createElement('canvas'), liveCtx = live.getContext('2d'),
    overlay   = document.createElement('canvas'), overlayCtx = overlay.getContext('2d');

overlay.id = 'overlay';
live.id = 'live';
container.id = 'container';
previewsContainer.id = 'preview-container';

container.appendChild(live);
container.appendChild(overlay);

document.body.appendChild(previewsContainer);
document.body.appendChild(container);

var url = document.location.href + 'api/sony/camera';

var stream = shoe('/ws');
var d = dnode({
  updateChessboard: function(frameType, seq, corners) {
    if(frameType === consts.PREVIEW) {
      drawCorners(overlayCtx, corners, overlay.width, overlay.height);
    } else {
      var preview = document.createElement('img'), 
          previewCanvas = document.createElement('canvas');

      preview.addEventListener('load', function() {
        var width = preview.width, height = preview.height;
        previewCanvas.width = width;
        previewCanvas.height = height;
        drawCorners(previewCanvas.getContext('2d'), corners, width, height, width/consts.imageSize[0], height/consts.imageSize[1]); 
      });
      preview.src = `/frame/${encodeURIComponent(seq)}?width=150`;
      
      var previewContainer = document.createElement('div');
      previewContainer.appendChild(preview);
      previewContainer.appendChild(previewCanvas);

      previewsContainer.appendChild(previewContainer);
      console.log('append!!!', previewContainer);
    }
  }
});
d.pipe(stream).pipe(d);

function drawCorners(ctx, corners, width, height, scaleX = 1, scaleY = 1) {
  corners = corners  || [];
  ctx.clearRect(0, 0, width, height);
  ctx.beginPath();
  corners.forEach(function(corner) {
    corner = corner[0];
    ctx.moveTo(corner[0] * scaleX, corner[1] * scaleY);
    ctx.arc(corner[0] * scaleX, corner[1] * scaleY, 10 * scaleX, 0, 2 * Math.PI);
  });
  if(corners.length === (consts.chessBoard[0] * consts.chessBoard[1])) {
    ctx.strokeStyle = 'rgba(0, 255, 0, 100)';
  } else {
    ctx.strokeStyle = 'rgba(255, 0, 0, 100)';
  }
  ctx.stroke();
  ctx.closePath();
}

request({ url: url, method: 'POST', body: JSON.stringify({
  method: 'stopRecMode',
  params: [],
  id: 1,
  version: '1.0',
})}, function(err, res, body) {
  request({ url: url, method: 'POST', body: JSON.stringify({
    method: 'startRecMode',
    params: [],
    id: 1,
    version: '1.0',
  })}, function(err, res, body) {
    request({ url: url, method: 'POST', body: JSON.stringify({
      method: 'startLiveviewWithSize',
      params: ['L'],
      id: 1,
      version: '1.0'
    })}, function(err, res, body) {
      setTimeout(function() {
        request({ url: url, method: 'POST', body: JSON.stringify({
          method: 'setPostviewImageSize',
          params: ['Original'],
          id: 1,
          version: '1.0'
        })}, function(err, res, body) {
          var liveviewUrl = document.location.href + 'api/liveview'; 
          
          request({ url: liveviewUrl, method: 'GET' }).on('response', function(res) {
            var setSize = false;
            
            var decode = decoder(function(seq, timestamp, jpegBuffer) {
              var frame = new Image(), blobURL;
              frame.onload = function() {
                if(!setSize) {
                  live.width = frame.width;
                  live.height = frame.height;
                  overlay.width = frame.width;
                  overlay.height = frame.height;
                  container.style.width = frame.width;
                  container.style.height = frame.height;
                  setSize = true;
                }
                liveCtx.drawImage(frame, 0, 0);
                URL.revokeObjectURL(blobURL);
              }

              var blob = new Blob([jpegBuffer], { type: 'image/jpeg' });
              blobURL = URL.createObjectURL(blob);
              frame.src = blobURL;
            });

            res.on('data', decode.chunk);
          });

          res.on('close', function() {
            console.log('close');
          });

          res.on('error', function(e) {
            console.log('error', e);
          });
        });
      }, 2000);
    });
  });
});
