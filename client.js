var request = require('request'),
    dnode   = require('dnode'),
    shoe    = require('shoe'),
    consts  = require('./consts'),
    decoder = require('./liveviewDecoder');

var container = document.createElement('div'),
    controlsContainer = document.createElement('div'),
    previewsContainer = document.createElement('div'),
    videoControls     = document.createElement('div'),
    live      = document.createElement('canvas'), liveCtx = live.getContext('2d'),
    overlay   = document.createElement('canvas'), overlayCtx = overlay.getContext('2d'),
    persist   = document.createElement('canvas'), persistCtx = persist.getContext('2d');

var remote, sessionsByTimestamp = {}, calibrationsById = {}, currentSessionTimestamp, currentCalibrationId;
var createNewSession = document.createElement('button'),
    toggleCapture = document.createElement('button'), 
    createNewCalibration = document.createElement('button'),
    captureSessionsSelect = document.createElement('select'),
    calibrationSelect = document.createElement('select');

createNewSession.innerText = 'New Session';
toggleCapture.innerText = 'Start Capture';
createNewCalibration.innerText = 'New Calibration';
createNewCalibration.setAttribute('disabled', 'disabled');
toggleCapture.setAttribute('disabled', 'disabled');
createNewCalibration.setAttribute('disabled', 'disabled');

var formatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'numeric', day: 'numeric',
  hour: 'numeric', minute: 'numeric', second: 'numeric',
  hour12: true,
  timeZone: 'America/Los_Angeles' 
});

function updateCaptureSelect(sessionsByTimestamp) {
  captureSessionsSelect.innerHTML = `<option value="" disabled="disabled" ${(!currentSessionTimestamp || !sessionsByTimestamp[currentSessionTimestamp]) ? 'selected="selected"' : ''}>Select a session</option>` + Object.keys(sessionsByTimestamp).map(function(timestamp) {
    var session = sessionsByTimestamp[timestamp];
    return `<option ${session.timestamp === currentSessionTimestamp ? 'selected="selected"' : ''} id="${session.timestamp}">${formatter.format(new Date(session.timestamp))}</option>`;
  }).join('');
}

function updateCalibrationSelect(sessionsByTimestamp) {
  calibrationSelect.innerHTML = `<option value="" disabled="disabled" ${!currentCalibrationId ? 'selected="selected"' : ''}>Select a calibration</option>` + Object.keys(sessionsByTimestamp).map(function(timestamp) {
    var session = sessionsByTimestamp[timestamp], calibrations = Object.keys(session.calibrations);
    return `<optgroup label="${formatter.format(new Date(session.timestamp))}">` + (calibrations.length === 0 ? `<option disabled="disabled">No calibrations</option></optgroup>` : calibrations.map(function(calibrationId) {
        return `<option ${parseInt(calibrationId) === currentCalibrationId ? 'selected="selected"' : ''} id="${calibrationId}" value="${calibrationId}">${calibrationId}</option>`;
      }).join('') + '</optgroup>');
  });
}

function enableCalibration() {
  var session = sessionsByTimestamp[currentSessionTimestamp];
  if(!session) return;
  var stats = getSessionStats(session);
  if(stats.points) {
    createNewCalibration.removeAttribute('disabled');
  } else {
    createNewCalibration.setAttribute('disabled', 'disabled');
  }
}

function getSessionStats(session) {
  return {
    photos: session.photos.length || 0,
    points: (session.photos || []).map(function(photo) {
      return photo.points.length || 0;
    }).reduce(function(acc, current) {
      return acc + current;
    }, 0),
    invalidPhotos: (session.photos || []).map(function(photo) {
      return (photo.points.length ? true : false);
    }).reduce(function(acc, current) {
      if(current) return acc + 1;
      return acc;
    }, 0)
  };
}

videoControls.classList.add('hidden');
var undistort = document.createElement('button');

function updateVideoControls() {
  if(!currentCalibrationId) return videoControls.classList.add('hidden');
  videoControls.classList.remove('hidden');


}

// show calibration window with details on calibration parameters, graph of pixel error, chessboard visualization

createNewCalibration.addEventListener('click', function() {
  remote.createNewCalibration(currentSessionTimestamp, consts.FULLSIZE, function(err, calibration) {
    sessionsByTimestamp[calibration.timestamp].calibrations[calibration.id] = calibration;
    currentCalibrationId = calibration.id;
    updateCalibrationSelect(sessionsByTimestamp);
    updateVideoControls();
  });
});

createNewSession.addEventListener('click', function() {
  if(remote) {
    remote.createNewSession(function(err, sessionsByTimestamp, session) {
      currentSessionTimestamp = session.timestamp;
      updateCaptureSelect(sessionsByTimestamp); 
      toggleCapture.innerText = 'Start Capture';
      toggleCapture.removeAttribute('disabled');
      enableCalibration();
    });
  }
});

toggleCapture.addEventListener('click', function() {
  if(remote && currentSessionTimestamp) {
    remote.toggleSessionCapture(function(err, session) {
      if(session) {
        toggleCapture.innerText = session.captureEnabled ? 'Stop Capture' : 'Continue Capture';
      }
    });
  }
});

captureSessionsSelect.addEventListener('change', function() {
  if(remote) {
    setRemoteCaptureSession(this.options[this.selectedIndex].id);
  }
});

overlay.id = 'overlay';
persist.id = 'persist';
live.id = 'live';
container.id = 'container';
previewsContainer.id = 'preview-container';
videoControls.id = 'video-controls';

container.appendChild(live);
container.appendChild(overlay);
container.appendChild(persist);
container.appendChild(videoControls);

controlsContainer.appendChild(createNewSession);
controlsContainer.appendChild(toggleCapture);
controlsContainer.appendChild(captureSessionsSelect);
controlsContainer.appendChild(calibrationSelect);
controlsContainer.appendChild(createNewCalibration);

document.body.appendChild(controlsContainer);
document.body.appendChild(previewsContainer);
document.body.appendChild(container);

var url = document.location.href + 'api/sony/camera';

var stream = shoe('/ws');
var d = dnode({
  updateChessboard: function(frameType, timestamp, seq, corners) {
    if(frameType === consts.PREVIEW) {
      drawCorners(overlay, overlayCtx, corners, overlay.width, overlay.height);
    } else {
      if(currentSessionTimestamp !== timestamp) return;
      var preview = document.createElement('img'), 
          previewCanvas = document.createElement('canvas');

      preview.addEventListener('load', function() {
        var width = preview.width, height = preview.height;
        previewCanvas.width = width;
        previewCanvas.height = height;
        drawCorners(previewCanvas, previewCanvas.getContext('2d'), corners[1], width, height, width/consts.imageSize[0], height/consts.imageSize[1]); 
      });
      preview.src = `/frame/${encodeURIComponent(seq)}?width=150`;
      
      var previewContainer = document.createElement('div');
      previewContainer.appendChild(preview);
      previewContainer.appendChild(previewCanvas);

      previewsContainer.appendChild(previewContainer);
      
      drawCorners(persist, persistCtx, corners[0], overlay.width, overlay.height, 'rgba(0, 255, 0, 1.0)', false);
    }
  },
  updateSession: function(timestamp, session) {
    sessionsByTimestamp[timestamp] = session;
  },
  updateCalibration: function(id, calibration) {
    calibrationsById[id] = calibration;
    if(id === currentCalibrationId) updateCalibrationDisplay(calibration);
  }
});
d.pipe(stream).pipe(d);
function setRemoteCaptureSession(timestamp) {
  currentSessionTimestamp = timestamp;
  remote.setCurrentSession(timestamp, 
    function(err, sessionsByTimestamp, timestamp) {
      toggleCapture.innerText = 'Continue Capture'; 
      toggleCapture.removeAttribute('disabled');
      enableCalibration();
    }
  );
}

function updateCalibrationDisplay(calibration) {

}

d.on('remote', function(r) {
  remote = r;

  remote.getSessions(function(err, _sessionsByTimestamp, _currentSessionTimestamp) {
    currentSessionTimestamp = _currentSessionTimestamp;
    sessionsByTimestamp = _sessionsByTimestamp;
    
    if(currentSessionTimestamp) setRemoteCaptureSession(currentSessionTimestamp);

    updateCaptureSelect(sessionsByTimestamp);
    updateCalibrationSelect(sessionsByTimestamp);
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
