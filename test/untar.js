var tar = require('tar')
var zlib = require('zlib')
var fs = require('fs')
var path = require('path')
var hash = require('crypto').createHash('sha1')
fs.createReadStream(path.join(__dirname, 'fixtures', 'request', '2.27.0','package.tgz'))
//.on('close', function () {console.log('close')})
.on('data', function (d) {
  hash.update(d)
})
.pipe(zlib.createGunzip())
.pipe(tar.Extract({path:__dirname}))
.on('end', function () {
  console.log('END', hash.digest())
})
.on('error', console.error)

