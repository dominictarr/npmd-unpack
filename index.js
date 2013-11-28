#! /usr/bin/env node
var http   = require('http')
var https  = require('https')
var fs     = require('fs')
var path   = require('path')
var mkdirp = require('mkdirp')
var rimraf = require('rimraf')
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

var registry = 'http://isaacs.iriscouch.com/registry'

function getUrl (pkg, config) {
  pkg = toPkg(pkg)

  if(/^https?/.test(pkg.from))
    return pkg.from

  return (
    (config.registry||registry) +"/" 
  + pkg.name + "/" 
  + pkg.name + "-" 
  + pkg.version + ".tgz"
  )
}

// Would be better to store the tarball as it's hash,
// not it's version. that would allow exact shrinkwraps.
// Probably want to fallback to getting the other cache, for speed.
// But to pull down new deps...
// Also... hashes would allow peer to peer module hosting, and multiple repos...

function getCache (pkg, config) {
  pkg = toPkg(pkg)

  if(config && config.cacheHash)
    return path.join(config.cache, pkg.shasum, 'package.tgz')

  return path.join(
    config.cache || path.join(process.env.HOME, '.npm'),
    pkg.name, pkg.version, 'package.tgz'
  )
}


// pull a package from the registry

function get (url, cb) {
  var urls = [], end
  _get(url, cb)
  function _get (url) {
    urls.push(url)
    if(end) return
    if(urls.length > 5)
      cb(end = new Error('too many redirects\n'+JSON.stringify(urls)))

    console.error('GET', url)
    ;(/^https/.test(url) ? https : http).get(url, function next (res) {

      if(res.statusCode >= 300 && res.statusCode < 400)
        _get(res.headers.location)
      else {
        end = true,
        cb(null, res)
      }
    })
    .on('error', function (err) {
      if(!end)
        cb(end = err)
    })
  }
}

var currentDownloads = {}

function getDownload(pkg, config, cb) {
  pkg = toPkg(pkg)
  var cache = getCache(pkg, config)
  mkdirp(path.dirname(cache), function () {
    var url = getUrl(pkg, config)

//    var c = currentDownloads[url]
//    if(c) {
//      console.log('AWAITING', url)
//      return c.push(cb)
//    }
//    c = currentDownloads[url] = []

    get(url, function (err, res) {
      if(err) return cb(err)
      var tmp = path.join(config.cache, 'tmp'+Date.now() + Math.random())
      res.pipe(fs.createWriteStream(tmp))
        .on('close', function () {
          fs.rename(tmp, cache, function (err) {
            if(err)
              console.error(err.stack)
          })
        })

//        .on('close', function () {
//          var s = fs.createReadStream(cache)
//          c.forEach(function (cb) {
//            cb(null, s)
//          })
//          delete currentDownloads[url]
//        }))

      cb(null, res)
    })
  })
}

// stream a tarball - either from cache or registry

function getTarballStream (pkg, config, cb) {
  var cache = getCache(pkg, config)
  fs.stat(cache, function (err) {
    if(!err)
      cb(null, fs.createReadStream(cache))
    else
      getDownload(pkg, config, cb)
  })
}

// unpack a tarball to some target directory.
// recommend unpacking to tmpdir and then moving a following step.

//ALSO, should hash the file as we unpack it, and validate that we get the correct hash.

function getTmp (config) {
  return path.join(config.tmpdir || '/tmp', ''+Date.now() + Math.random())
}
  
function unpack (pkg, config, cb) {
  if(!cb)
    cb = config, config = {}
  var tries = 0
  ;(function _unpack () {
  tries ++
  pkg = toPkg(pkg)

  if(!pkg.version)
    return cb(new Error(pkg.name + ' has no version'))

  var name = pkg.name
  var ver  = pkg.version

  var cache = getCache(pkg, config)
  var tmp = config.target || getTmp(config)

  mkdirp(tmp, function (err) {
    getTarballStream(pkg, config, function (err, stream) {
      if(err) return cb(err)

      var i = 2
      var hash = crypto.createHash('sha1')
      stream.on('data', function (b) {
          hash.update(b)
      })
      .on('error', next)
      .on('end', next)

      stream
      .pipe(zlib.createGunzip())
      .on('error', function (err) {
        err.message = (
            err.message
          + '\n trying to unpack '
          + name + '@' + ver
        )
        next(err)
      })
      .on('error',next)
      .pipe(tar.Extract({path: tmp}))
      .on('error', function (err) {
        err.message = err.message + '\nwhile unpacking:' + pkg.name + '@' + pkg.version
        next(err)
      })
      .on('end', next)

      function next (err) {
        if(err && i) return i = -1, cb(err)
        if(--i) return
        if(err)
          err.message = err.message + '\nattempting to unpack:'+ pkg.name + '@' + pkg.version

        //if there was an error, remove the cached file...
//        if(err)
//          return rimraf(path.dirname(cache), function (_) {
//            if(_) console.error('TIDY UP ERROR', _.stack)
//          console.log('ERR', err)
//              cb(err)
//          })

        var shasum = hash.digest('hex')

        if(pkg.shasum && shasum !== pkg.shasum) {
          console.log('WARN' ,pkg.shasum+'!=='+shasum)
          if(!config.offline) {
            if(tries <= 1) {
              console.error('redownloading:', pkg.name+'@'+pkg.version+'=='+pkg.shasum)
              return rimraf(path.dirname(cache), function (err) {
                if(err || tries > 1) return cb(err)
                _unpack(pkg, config, cb)
              })
            } else {
              console.error('**************************')
              console.error('WARNING. We have tried to download')
              console.error(pkg.name +'@'+pkg.version, 'twice now, but keep getting the wrong hash')
              console.error('probably, this is because the author did npm publish --force')
              console.error('but your local data has not synced with that. continuing')
              console.error('**************************')
            }
          }
        }
        cb(err, shasum)
      }
    })
  })
  })()
}

exports.unpack = unpack
exports.toPkg  = toPkg
exports.getUrl = getUrl
exports.getCache = getCache

if(!module.parent) {
  var config = require('npmd-config')
  var data = ''
  if(!process.stdin.isTTY)
    process.stdin
      .on('data', function (d) { data += d })
      .on('end', function () {
        unpack(JSON.parse(data), config, next)
      })
  else {
    var m = (config._[0] || '').split('@')
    var module = m.shift()
    var version = m.shift()
    if(!(module && version && config.from))
      new Error('needs arguments: module@version or --from URL')

    unpack({
      name: module,
      version: version,
      from: config.from,
      shasum: config.shasum
    }, config, next)
  }

  function next(err, hash) {
    if(err) throw err
    console.log(hash)
  }


}
