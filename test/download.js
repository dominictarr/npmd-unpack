
var u = require('../')
var os = require('os')
var path = require('path')
var shasum = require('shasum')
var fs = require('fs')
var rimraf = require('rimraf')
var assert = require('assert')
var test = require('tape')

var testCache = path.join(os.tmpdir(), 'test-cache' + Date.now())
var testTarget = path.join(os.tmpdir(), 'test-target' + Date.now())

var opts = {cache: testCache, target: testTarget}

var expectedPkg = path.join(testTarget, 'package', 'package.json')
var expectedHash = '2b293fe42342bd9abf103963ada817acc9588c9b'

//first should download,
//and then unpack from cache.
test('unpack curry', function (t) {
  u.unpack('curry@0.0.3', opts, function (err, _hash) {
    console.log('HASH', _hash)
    t.equal(_hash, 'da7c18390af7d624ca90e380c2146dbf7719847a')

    fs.readFile(path.join(testCache, 'curry', '0.0.3', 'package.tgz'), function (err, b) {
      console.log('SHASUM', shasum(b))

    })
    fs.readFile(expectedPkg, function (err, val) {
      var hash = shasum(val)
      t.equal(hash, expectedHash)
      rimraf(testTarget, function () {
        u.unpack('curry@0.0.3', opts, function (err, pkg) {
          fs.readFile(expectedPkg, function (err, val) {
            var _hash = shasum(val)
            t.equal(_hash, expectedHash)
            t.end()
          })
        })
      })
    })
  })
})

