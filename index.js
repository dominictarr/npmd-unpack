var http   = require('http')
var fs     = require('fs')
var path   = require('path')
var mkdirp = require('mkdirp')
var zlib   = require('zlib')
var tar    = require('tar')
var crypto = require('crypto')

function toPkg(pkg) {
  if('string' === typeof pkg) {
    pkg = pkg.split('@')
    return {name: pkg[0], version: pkg[1] || '*'}
  }
  return pkg
}

function getUrl (pkg, opts) {
  pkg = toPkg(pkg)
  return registry +"/" + pkg.name + "/" + pkg.name + "-" + pkg.version + ".tgz"
}

// Would be better to store the tarball as it's hash,
// not it's version. that would allow exact shrinkwraps.
// Probably want to fallback to getting the other cache, for speed.
// But to pull down new deps...
// Also... hashes would allow peer to peer module hosting, and multiple repos...

function getCache (pkg, opts) {
  pkg = toPkg(pkg)

  if(opts && opts.cacheHash)
    return path.join(opts.cache, pkg.shasum, 'package.tgz')

  return path.join(
    opts.cache || path.join(process.env.HOME, '.npm'),
    pkg.name, pkg.version, 'package.tgz'
  )
}

var registry = 'http://isaacs.iriscouch.com/registry'

function getUrl (pkg, opts) {
  pkg = toPkg(pkg)
  return (opts.registry || registry) +"/" + pkg.name + "/" + pkg.name + "-" + pkg.version + ".tgz"
}

// pull a package from the registry

function getDownload(pkg, opts, cb) {
  pkg = toPkg(pkg)
  var cache = getCache(pkg, opts)
  mkdirp(path.dirname(cache), function () {
    console.log('URL', getUrl(pkg, opts))
    http.get(getUrl(pkg, opts), function (res) {      
      res.pipe(fs.createWriteStream(cache))
      cb(null, res)
    })
  })
}

// stream a tarball - either from cache or registry

function getTarballStream (pkg, opts, cb) {
  var cache = getCache(pkg, opts)
  console.log(cache)
  fs.stat(cache, function (err) {
    if(!err)
      cb(null, fs.createReadStream(cache))
    else
      getDownload(pkg, opts, cb)
  })
}

// unpack a tarball to some target directory.
// recommend unpacking to tmpdir and then moving a following step.

//ALSO, should hash the file as we unpack it, and validate that we get the correct hash.
  
function unpack (pkg, opts, cb) {
  if(!cb)
    cb = opts, opts = {}

  pkg = toPkg(pkg)

  if(!pkg.version)
    return cb(new Error(pkg.name + ' has no version'))

  var name = pkg.name
  var ver  = pkg.version
  //SHOULD COME FROM CONFIG
  var cache = getCache(pkg, opts)
  var tmp = opts.target || path.join(tmpdir, ''+Date.now() + Math.random())

  mkdirp(tmp, function (err) {
    getTarballStream(pkg, opts, function (err, stream) {
      if(err) return cb(err)

      var i = 2
      stream.on('error', next)

      var hash = crypto.createHash('sha1')
      stream.on('data', function (b) {
          hash.update(b)
      })
      //TODO: if the hash is wrong, and we are online,
      //stop now, download again, and replace the cached tarball.
      .on('end', next)

      stream.pipe(zlib.createGunzip())
      .on('error', function (err) {
        err.message = (
            err.message
          + '\n trying to unpack '
          + name + '@' + ver
        )
        i = -1; cb(err)
      })
      .pipe(tar.Extract({path: tmp}))
      .on('end', next)

      function next (err) {
        if(--i) return
        
        cb(err, hash.digest('hex'))
      }
    })
  })
}

exports.unpack = unpack
exports.toPkg  = toPkg
exports.getUrl = getUrl
exports.getCache = getCache

