var request = require('request');
var assign = require('lodash.assign');
var debug = require('debug')('inliner');
var Promise = require('es6-promise').Promise; // jshint ignore:line
var fs = require('then-fs');
var mime = require('mime');
var basename = require('path').basename;
const puppeteer = require('puppeteer');

var cache = {};

module.exports = function get(url, options) {
  var inliner = this;
  if (url.indexOf('data:') === 0) {
    debug('asset already inline', url);
    return Promise.resolve({
      headers: {
        'content-type': url.slice(5).replace(/;.*$/, ''),
      },
      body: url,
    });
  }

  if (cache[url]) {
    debug('request responding with cache');
    return cache[url];
  }

  var base = basename(url);

  this.emit('progress', 'loading ' + base);

  if (this.isFile && url.indexOf('http') !== 0) {
    debug('inliner.get file: %s', url);
    cache[url] = fs.readFile(url).catch(function (error) {
      if (error.code === 'ENOENT' || error.code === 'ENAMETOOLONG') {
        debug(error.code + ': ' + base + ', trying decodeURI');
        return fs.readFile(decodeURI(url));
      }
      throw error;
    }).then(function read(body) {
      return {
        body: body,
        headers: {
          'content-type': mime.lookup(url),
        },
      };
    }).catch(function (error) {
      if (error.code === 'ENOENT') {
        inliner.emit('warning', 'no such file: ' + base);
      }

      return {
        body: '',
        headers: {
          'content-type': mime.lookup(url),
        },
      };
    });

    return cache[url];
  }

  debug('inliner.get url: %s', url);

  var settings = assign({}, options, {
    encoding: null,
    followRedirect: true,
    headers: inliner.headers,
  });

  debug('request %s', url, settings);

  cache[url] = new Promise(function (resolve) {
    if (!settings.root) {
      request(encodeURI(url), settings, function response(error, res, body) {
        if (error) {
          debug('request failed: %s', error.message);
          inliner.emit('warning', 'failed to request ' + base + ' (' +
            error.message + ')');

          body = '';
          res = {
            headers: {},
          };
        } else if (res.statusCode !== 200) {
          inliner.emit('warning', res.statusCode + ' on ' + base);
        }

        debug('response: %s %s', res.statusCode, url);

        if (res.statusCode >= 400) {
          body = '';
        }

        resolve({
          body: body,
          headers: res.headers,
          statusCode: res.statusCode,
        });
      });
    } else {
      puppeteer.launch().then(function (browser) {
        browser.newPage().then(function (page) {
          page
            .setViewport({
              width: 1366,
              height: 768,
              deviceScaleFactor: 1,
            })
            .then(function () {
              page
                .goto(encodeURI(url), { waitUntil: 'networkidle2' })
                .then(function (response) {
                  setTimeout(() => {
                    page.content().then(function (content) {
                      resolve({
                        body: content,
                        headers: response.headers(),
                        statusCode: response.status(),
                      });
                      browser.close();
                    });
                  }, 10000);
                });
            });
        });
      });
    }
  });

  return cache[url];
};
