var glob      = require('glob'),
    path      = require('path'),
    fs        = require('fs'),
    sanitize  = require('sanitize-filename'),
    sha1      = require('sha1-file'),
    sharp     = require('sharp'),
    app       = require('../index');

glob('**/index.json', { cwd: path.resolve(__dirname, '../', 'data') }, function(err, sessionFiles) {
  sessionFiles.forEach(function(sessionFile) {
    var session = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../', 'data', sessionFile))),
        version = parseFloat(session.version);
    
    console.log('Found file', sessionFile, 'version', version);
    if(version < 1) {
      console.log(`Migrating ${sessionFile} to v1...`);
      
      session.captureEnabled = false;
      session.calibrations = {};
      session.calibrationCount = 0;
      session.version = 1;

      var processedPhotos = 0;
      session.photos.forEach(function(photo) {
        var origPath = path.resolve(__dirname, '../', 'data', session.timestamp.toString(), `${photo.id}.jpg`);

        sharp(origPath)
          .metadata(function(err, meta) {
            photo.meta = meta;
            console.log('old path', photo.id);
            photo.id = sanitize(sha1(origPath));
            console.log('new path', photo.id);
            fs.renameSync(origPath, path.resolve(__dirname, '../', 'data', session.timestamp.toString(), `${photo.id}.jpg`));
            processedPhotos++;

            if(processedPhotos === session.photos.length) {
              fs.writeFileSync(path.resolve(__dirname, '../', 'data', sessionFile), JSON.stringify(session));
            }
          });
      });
    } else if(version < 5) {
      console.log(`Migrating ${sessionFile} to v5...`);

      app.reprocessSessionPhotos(session, function(session) {
        console.log('Done with session', session.timestamp);
        console.log(session.photos[0].points);
        session.version = 5;
        fs.writeFileSync(path.resolve(__dirname, '../', 'data', sessionFile), JSON.stringify(session));
        process.exit(0);
      });
    }
  });
});
