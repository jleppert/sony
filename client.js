var request = require('request'),
    dnode   = require('dnode'),
    shoe    = require('shoe'),
    consts  = require('./consts'),
    decoder = require('./liveviewDecoder');

var container = document.createElement('div'),
    controlsContainer = document.createElement('div'),
    previewsContainer = document.createElement('div'),
    live      = document.createElement('canvas'), liveCtx = live.getContext('2d'),
    overlay   = document.createElement('canvas'), overlayCtx = overlay.getContext('2d'),
    persist   = document.createElement('canvas'), persistCtx = persist.getContext('2d');

var remote, currentSessionTimestamp;
var createNewSession = document.createElement('button'),
    toggleCapture = document.createElement('button'), 
    captureSessionsSelect = document.createElement('select');

createNewSession.innerText = 'New Session';
toggleCapture.innerText = 'Start Capture';
toggleCapture.setAttribute('disabled', 'disabled');

var formatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric',
  hour12: true,
  timeZone: 'America/Los_Angeles' 
});

function updateCaptureSelect(sessionsByTimestamp) {
  captureSessionsSelect.innerHTML = `<option value="" disabled="disabled" ${(!currentSessionTimestamp || !sessionsByTimestamp[currentSessionTimestamp]) ? 'selected="selected"' : ''}>Select a session</option>` + Object.keys(sessionsByTimestamp).map(function(timestamp) {
    var session = sessionsByTimestamp[timestamp];
    return `<option ${session.timestamp === currentSessionTimestamp ? 'selected="selected"' : ''} id="${session.timestamp}">${formatter.format(session.timestamp)}</option>`;
  }).join('');
}

createNewSession.addEventListener('click', function() {
  if(remote) {
    remote.createNewSession(function(err, sessionsByTimestamp, session) {
      currentSessionTimestamp = session.timestamp;
      updateCaptureSelect(sessionsByTimestamp); 
      toggleCapture.innerText = 'Start Capture';
      toggleCapture.removeAttribute('disabled');
    });
  }
});

toggleCapture.addEventListener('click', function() {
  if(remote && currentSessionTimestamp) {
    remote.toggleSessionCapture(function(session) {
      toggleCapture.innerText = session.captureEnabled ? 'Stop Capture' : 'Start Capture';
    });
  }
});

captureSessionsSelect.addEventListener('change', function() {
  if(remote) {
    remote.setCurrentSession(this.options[this.selectedIndex].id, 
      function(err, sessionsByTimestamp, timestamp) {
        currentSessionTimestamp = timestamp;
        toggleCapture.removeAttribute('disabled');
      }
    );
  }
});

overlay.id = 'overlay';
persist.id = 'persist';
live.id = 'live';
container.id = 'container';
previewsContainer.id = 'preview-container';

container.appendChild(live);
container.appendChild(overlay);
container.appendChild(persist);

controlsContainer.appendChild(createNewSession);
controlsContainer.appendChild(toggleCapture);
controlsContainer.appendChild(captureSessionsSelect);

document.body.appendChild(controlsContainer);
document.body.appendChild(previewsContainer);
document.body.appendChild(container);

var url = document.location.href + 'api/sony/camera';

var stream = shoe('/ws');
var d = dnode({
  updateChessboard: function(frameType, seq, corners) {
    if(frameType === consts.PREVIEW) {
      drawCorners(overlay, overlayCtx, corners, overlay.width, overlay.height);
    } else {
      var preview = document.createElement('img'), 
          previewCanvas = document.createElement('canvas');

      preview.addEventListener('load', function() {
        var width = preview.width, height = preview.height;
        previewCanvas.width = width;
        previewCanvas.height = height;
        drawCorners(previewCanvas, previewCanvas.getContext('2d'), corners, width, height, width/consts.imageSize[0], height/consts.imageSize[1]); 
      });
      preview.src = `/frame/${encodeURIComponent(seq)}?width=150`;
      
      var previewContainer = document.createElement('div');
      previewContainer.appendChild(preview);
      previewContainer.appendChild(previewCanvas);

      previewsContainer.appendChild(previewContainer);
      console.log('append!!!', previewContainer);

      drawCorners(persist, persistCtx, corners, overlay.width, overlay.height, consts.previewSize[0] / consts.imageSize[0], consts.previewSize[1] / consts.imageSize[1], 'rgba(0, 255, 0, 1.0)', false);
    }
  }
});
d.pipe(stream).pipe(d);

d.on('remote', function(r) {
  remote = r;
  remote.getSessions(function(err, sessionsByTimestamp, _currentSessionTimestamp) {
    currentSessionTimestamp = _currentSessionTimestamp;
    updateCaptureSelect(sessionsByTimestamp);
  });
});

function drawCorners(el, ctx, corners, width, height, scaleX = 1, scaleY = 1, strokeStyle = 'rgba(0, 255, 0, 1.0)', clear = true) {
  corners = corners  || [];
  if(clear) ctx.clearRect(0, 0, width, height);
  ctx.beginPath();

  corners.forEach(function(corner, i) {
    corner = corner[0];
    
    if(i === 0) ctx.moveTo(corner[0] * scaleX, corner[1] * scaleY);
    if(i > 0) ctx.lineTo(corner[0] * scaleX, corner[1] * scaleY);
    ctx.arc(corner[0] * scaleX, corner[1] * scaleY, 10 * scaleX, 0, 2 * Math.PI);
  });
  if(corners.length === (consts.chessBoard[0] * consts.chessBoard[1])) {
    ctx.strokeStyle = strokeStyle;
    el.classList.remove('invalid');
    el.classList.add('valid');
  } else {
    ctx.strokeStyle = 'rgba(255, 0, 0, 1.0)';
    el.classList.remove('valid');
    el.classList.add('invalid');
  }
  ctx.stroke();
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
                  persist.width = frame.width;
                  persist.height = frame.height;
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
