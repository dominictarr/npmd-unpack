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

function getUrl (pkg, opts) {
  pkg = toPkg(pkg)

  if(/^https?/.test(pkg.from))
    return pkg.from

  return (
    (opts.registry||registry) +"/" 
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

function getCache (pkg, opts) {
  pkg = toPkg(pkg)

  if(opts && opts.cacheHash)
    return path.join(opts.cache, pkg.shasum, 'package.tgz')

  return path.join(
    opts.cache || path.join(process.env.HOME, '.npm'),
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

    console.log('GET', url)
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

function getDownload(pkg, opts, cb) {
  pkg = toPkg(pkg)
  var cache = getCache(pkg, opts)
  mkdirp(path.dirname(cache), function () {
    console.log('URL', getUrl(pkg, opts))
    get(getUrl(pkg, opts), function (err, res) {
      if(err) return cb(err)
      res.pipe(fs.createWriteStream(cache))
      cb(null, res)
    })
  })
}

// stream a tarball - either from cache or registry

function getTarballStream (pkg, opts, cb) {
  var cache = getCache(pkg, opts)
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

function getTmp (config) {
  return path.join(config.tmpdir || '/tmp', ''+Date.now() + Math.random())
}
  
function unpack (pkg, opts, cb) {
  if(!cb)
    cb = opts, opts = {}

  pkg = toPkg(pkg)

  if(!pkg.version)
    return cb(new Error(pkg.name + ' has no version'))

  var name = pkg.name
  var ver  = pkg.version

  var cache = getCache(pkg, opts)
  var tmp = opts.target || getTmp(config)

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

        //if there was an error, remove the cached file...
        if(err)
          return fs.rename(path.dirname(cache), getTmp(config), function (_) {
            cb(err)
          })

        var shasum = hash.digest('hex')

        //if the has is wrong, redownload the file, unless we are in offline mode.
        if(pkg.shasum && !config.offline && shasum !== pkg.shasum) {
          console.error(shasum+'!=='+pkg.shasum+', redownloading')
          return rimraf(path.dirname(cache), function (err) {
            if(err) return cb(err)
            unpack(pkg, config, cb)
          })
        }
          
        cb(err, shasum)
      }
    })
  })
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
