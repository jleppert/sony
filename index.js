#!/usr/bin/env node
var request     = require('request'), 
    fs          = require('fs'),
    browserify  = require('browserify-middleware'),
    path        = require('path'),
    express     = require('express'),
    decoder     = require('./liveviewDecoder'),
    zerorpc     = require('zerorpc'),
    dnode       = require('dnode'),
    shoe        = require('shoe'),
    sharp       = require('sharp'),
    http        = require('http'),
    mkdirp      = require('mkdirp'),
    sanitize    = require('sanitize-filename'),
    crypto      = require('crypto'),
    glob        = require('glob'),
    consts      = require('./consts');

var remote,
    frameQueue = [],
    fullSizeFrameQueue = [],
    calibrationQueue = [],
    calibrationsById = {},
    frameCount = 0, 
    maxQueueDepth = 30, 
    framesBySeq = {},
    fullSizeFramesByUrl = {},
    recTimeout = null,
    chessboardResultsBySeq = {};

var sessionsByTimestamp = {}, currentSessionTimestamp;
var files = glob.sync('**/index.json', { cwd: path.join(__dirname, 'data') });
files.forEach(function(file) {
  var session = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', file)));
  sessionsByTimestamp[session.timestamp] = session;
});

function currentSessionDataPath(timestamp) {
  if(timestamp) return path.join(__dirname, 'data', timestamp.toString());
  if(currentSessionTimestamp) return path.join(__dirname, 'data', currentSessionTimestamp);
}

var rpcServer = new zerorpc.Server({
  getFrameRequest: function(cb) {
    var sessUrl = fullSizeFrameQueue.shift();
    if(typeof(sessUrl) != 'undefined') return cb(null, [consts.FULLSIZE, sessUrl[0], sessUrl[1], fullSizeFramesByUrl[sessUrl[1]]]);
    var sessSeq = frameQueue.pop();
    if(typeof(sessSeq) === 'undefined') return cb(null, [null, null, null, null]);
    cb(null, [consts.PREVIEW, sessSeq[0], sessSeq[1], framesBySeq[sessSeq[1]]]);
    frameCount--;  
    delete framesBySeq[sessSeq[1]];
  },
  getCalibrationRequest: function(cb) {
    var id = calibrationQueue.shift();

    if(typeof(id) != 'undefined') {
      var calibration = calibrationsById[id];
      return cb(null, [id, calibration.size, calibration.points]); 
    }

    cb(null, [null, null, null]);
  },
  setCalibrationResults: function(id, results, cb) {
    console.log('got calibration results!!!', id, results);
    //cb(null);

    results = JSON.parse(results.toString());
    console.log('got calibration results!!!', id, results);

    calibrationsById[id].results = results;

    if(remote) remote.updateCalibration(id, calibrationsById[id]);
    var session = sessionsByTimestamp[calibrationsById[id].timestamp];
    session.calibrations[id] = results;
    cb(null); 
    fs.writeFileSync(path.join(__dirname, 'data', session.timestamp.toString(), 'index.json'), JSON.stringify(session)); 
  },
  setChessboardResults: function(frameType, timestamp, seq, results, cb) {
    cb(null);
    results = JSON.parse(results.toString());
    if(remote) remote.updateChessboard(frameType, timestamp, seq, results);
    if(frameType === consts.PREVIEW && results.length === (consts.chessBoard[0] * consts.chessBoard[1])) {
      var session = sessionsByTimestamp[timestamp];

      if(session && session.captureEnabled) {
        console.log('taking photo!!!');
        if(recTimeout) return;
        recTimeout = setTimeout(function() {
          request({ url: url + '/sony/camera', method: 'POST', body: JSON.stringify({
            method: 'setShootMode',
            params: ['still'],
            id: 1,
            version: '1.0',
          })}, function(err, res, body) {
            request({ url: url + '/sony/camera', method: 'POST', body: JSON.stringify({
              method: 'actTakePicture',
              params: [],
              id: 1,
              version: '1.0',
            })}, function(err, res, body) {
              recTimeout = null;
              var data = JSON.parse(body.toString()),
                  photoUrl = data.result[0][0];
              
              console.log('got photo!!', photoUrl);
              request({ url: photoUrl, method: 'GET', encoding: null }, function(err, res, body) {
                fullSizeFrameQueue.push([timestamp, photoUrl]);
                fullSizeFramesByUrl[photoUrl] = body;
              });
              console.log(data.result[0][0]);
              return;

              console.log('took photo', body);
            });
          });
        }, 1000);
      }
    } else if(frameType === consts.FULLSIZE) {
      var image = fullSizeFramesByUrl[seq];
      console.log('frametype fullsize', results); 
      sharp(image).metadata(function(err, meta) {
        var _meta = meta;
        delete _meta.exif;
        var photo = {
          id: sanitize(crypto.createHash('sha1').update(image).digest('hex')),
          points: results,
          meta: _meta
        };
        fs.writeFile(path.join(__dirname, 'data', timestamp.toString(), `${photo.id}.jpg`), new Buffer(fullSizeFramesByUrl[seq]), { encoding: null }, function(err) {
          if(!err) {
            console.log('Wrote file', photo.id);
            sessionsByTimestamp[timestamp].photos.push(photo);
            var util = require('util');

            console.log('calling update session', timestamp, util.inspect(sessionsByTimestamp[timestamp], { showHidden: false, depth: null }));
            if(remote) remote.updateSession(timestamp, sessionsByTimestamp[timestamp]);
            fs.writeFile(path.join(currentSessionDataPath(timestamp), 'index.json'), JSON.stringify(sessionsByTimestamp[timestamp]), function(err) {
              if(!err) console.log('wrote index file ok');
              if(err) console.log('error writing index file', err);
            });
          }
          if(err) console.log('Error writing file', photo.id, err);
        });
      });
    }
  }
});

rpcServer.bind('tcp://127.0.0.1:4242');

var url = 'http://192.168.122.1:8080';

var app = express();

app.use('/client.js', browserify(path.join(__dirname, 'client.js')));

app.use('/frame/:url', function(req, res) {
  var frame = fullSizeFramesByUrl[req.params.url];
  if(!frame) return res.status(404).end();
  var width = req.query.width ? parseInt(req.query.width) : null,
      height = req.query.height ? parseInt(req.query.height) : null;

  res.setHeader('content-type', 'image/jpeg');
  if(width || height) {
    s = sharp(frame).resize(width, height);
    if(!(width && height)) {
      s.max();
    }
    return s.toFormat('jpeg')
     .toBuffer(function(err, data) {
       res.end(data);
     });
  }

  res.status(200).end(frame);
});

app.use('/api/liveview', function(req, res) {
    request({ url: url + '/liveview/liveviewstream', method: 'GET'}).on('response', function(cameraRes) {
    res.status(200);
    
    var queue = [], queueDepth = 10; 
    var decode = decoder(function(seq, timestamp, jpegBuffer) {
      //console.log('got frame!!!', seq, timestamp);
        frameQueue.push([currentSessionTimestamp || 0, seq]);
        framesBySeq[seq] = jpegBuffer;
        frameCount++;

        //console.log(frameCount, frameQueue, Object.keys(framesBySeq));

        if(frameCount > maxQueueDepth) {
          delete framesBySeq[frameQueue.shift()[1]];
          frameCount--;
        }
    });
    cameraRes.on('data', function(chunk) {
      res.write(chunk);
      decode.chunk(chunk);
    });

    cameraRes.on('close', function() {
      res.end();
    });

    cameraRes.on('error', function(e) {
      console.error('camera stream error', e);
      res.end();
    });
  });
});

app.use('/api', function(req, res) {
  console.log(url, req.url);
  req.pipe(request(url + req.url)).pipe(res);
});

app.use(express.static('static'));

var server = http.createServer(app);
var sock = shoe(function(stream) {
  var d = dnode({
    createNewSession: function(cb) {
      var session = {
        timestamp: new Date().getTime(),
        photos: [],
        captureEnabled: false,
        calibrations: {},
        calibrationCount: 0
      };
      
      var dataPath = path.join(__dirname, 'data', session.timestamp.toString());
      mkdirp.sync(dataPath);
      fs.writeFileSync(path.join(dataPath, 'index.json'), JSON.stringify(session));

      sessionsByTimestamp[session.timestamp] = session;
      currentSessionTimestamp = session.timestamp;
      cb(null, sessionsByTimestamp, session);
    },
    toggleSessionCapture: function(cb) {
      var session = sessionsByTimestamp[currentSessionTimestamp];

      if(!session) return cb(null);
      session.captureEnabled = !session.captureEnabled;
      cb(null, session);
    },
    getSessions: function(cb) {
      cb(null, sessionsByTimestamp, currentSessionTimestamp);
    },
    setCurrentSession: function(timestamp, cb) {
      var session = sessionsByTimestamp[currentSessionTimestamp];
      if(session) session.captureEnabled = false;
      
      currentSessionTimestamp = timestamp;

      cb(null, sessionsByTimestamp, timestamp);
      fullSizeFrameQueue = [];
      fullSizeFramesByUrl = {};
      
      session = sessionsByTimestamp[timestamp]; 
      session.photos.forEach(function(photo) {
        fullSizeFramesByUrl[photo.id] = fs.readFileSync(path.join(__dirname, 'data', session.timestamp.toString(), `${photo.id}.jpg`));
        if(remote) remote.updateChessboard(consts.FULLSIZE, timestamp, photo.id, photo.points);
      });
    },
    createNewCalibration: function(timestamp, frameType, cb) {
      var session = sessionsByTimestamp[timestamp];
      session.calibrationCount++;
      
      var calibration = {
        id: session.calibrationCount,
        timestamp: timestamp,
        frameType: frameType,
        maps: [],
        size: frameType === consts.FULLSIZE ? consts.imageSize : consts.previewSize,
        points: session.photos.map(function(photo) {
          return frameType === consts.PREVIEW ? photo.points[0] : photo.points[1]
        })
      };

      calibrationsById[session.calibrationCount] = calibration; 
      calibrationQueue.push(session.calibrationCount);

      cb(false, calibration);
    }
  });
  
  d.on('remote', function(r) {
    remote = r;
  });
  
  d.pipe(stream).pipe(d);
});
sock.install(server, '/ws');

if(require.main === module) {
  server.listen(3000, function() {
    console.log('Camera UI started on', server.address().address + ':' + server.address().port);
  });
}

module.exports = {
  reprocessSessionPhotos: function(session, cb) {
    sessionsByTimestamp[session.timestamp] = session;
    var photos = JSON.parse(JSON.stringify(session.photos));
    session.photos = [];
    photos.forEach(function(photo, i) {
      console.log('Queue photo', photo.id);
      fullSizeFramesByUrl[photo.id] = fs.readFileSync(path.join(__dirname, 'data', session.timestamp.toString(), `${photo.id}.jpg`));
      fullSizeFrameQueue.push([session.timestamp, photo.id]);
      if(session.photos.length === (i + 1)) {
        startFrameQueueInterval();
      }
    });

    var frameQueueInterval;
    function startFrameQueueInterval() {
      frameQueueInterval = setInterval(function() {
        if(fullSizeFrameQueue.length === 0) {
          cb(session);
          clearInterval(frameQueueInterval);
        } else {
          console.log('Queue depth', fullSizeFrameQueue.length);
        }
      }, 1000);
    }
  }
};
