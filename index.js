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
    glob        = require('glob'),
    consts      = require('./consts');

var remote,
    frameQueue = [],
    fullSizeFrameQueue = [],
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

function currentSessionDataPath() {
  if(currentSessionTimestamp) return path.join(__dirname, 'data', currentSessionTimestamp);
}

var rpcServer = new zerorpc.Server({
  getFrame: function(cb) {
    var url = fullSizeFrameQueue.shift();
    if(typeof(url) != 'undefined') return cb(null, [consts.FULLSIZE, url, fullSizeFramesByUrl[url]]);
    var seq = frameQueue.pop();
    if(typeof(seq) === 'undefined') return cb(null, [null, null, null]);
    cb(null, [consts.PREVIEW, seq, framesBySeq[seq]]);
    frameCount--;  
    delete framesBySeq[seq];
  },
  setChessboardResults: function(frameType, seq, results, cb) {
    cb(null);
    results = JSON.parse(results.toString());
    if(remote) remote.updateChessboard(frameType, seq, results);
    if(results.length === (consts.chessBoard[0] * consts.chessBoard[1])) {
      if(frameType === consts.PREVIEW) {
        var currentSession = sessionsByTimestamp[currentSessionTimestamp];

        if(currentSession && currentSession.captureEnabled) {
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
                  fullSizeFrameQueue.push(photoUrl);
                  fullSizeFramesByUrl[photoUrl] = body;
                });
                console.log(data.result[0][0]);
                return;

                console.log('took photo', body);
              });
            });
          }, 1000);
        }
      } else {
        var photo = {
          id: sanitize(new Buffer(Math.random().toString()).toString('base64')),
          points: results
        };
        fs.writeFile(path.join(sessionDataPath, `${photo.id}.jpg`), new Buffer(fullSizeFramesByUrl[seq]), { encoding: null }, function(err) {
          if(!err) {
            console.log('Wrote file', photo.id);
            sessionsByTimestamp[currentSessionTimestamp].photos.push(photo);
            fs.writeFile(path.join(currentSessionDataPath(), 'index.json'), JSON.stringify(sessionsByTimestamp[currentSessionTimestamp]), function(err) {
              if(!err) console.log('wrote index file ok');
              if(err) console.log('error writing index file', err);
            });
          }
          if(err) console.log('Error writing file', photo.id, err);
        });
      
      
      session.photos.forEach(function(photo) {
        
      });}
    }
    //chessboardResultsBySeq[seq] = results;
    //cb(null);
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
        frameQueue.push(seq);
        framesBySeq[seq] = jpegBuffer;
        frameCount++;

        //console.log(frameCount, frameQueue, Object.keys(framesBySeq));

        if(frameCount > maxQueueDepth) {
          delete framesBySeq[frameQueue.shift()];
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
        captureEnabled: false
      };
      
      mkdirp.sync(path.join(__dirname, 'data', session.timestamp.toString()));

      sessionsByTimestamp[session.timestamp] = session;
      currentSessionTimestamp = session.timestamp;
      cb(null, sessionsByTimestamp, session);
    },
    toggleSessionCapture: function(cb) {
      var session = sessionsByTimestamp[currentSessionTimestamp];

      if(!session) return cb(null);
      session.captureEnabled = !session.captureEnabled;
      cb(null, sessionsByTimestamp, session);
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
        if(remote) remote.updateChessboard(consts.FULLSIZE, photo.id, photo.points);
      });
    }
  });
  
  d.on('remote', function(r) {
    remote = r;
  });
  
  d.pipe(stream).pipe(d);
});
sock.install(server, '/ws');

server.listen(3000, function() {
  console.log('Camera UI started on', server.address().address + ':' + server.address().port);
});
