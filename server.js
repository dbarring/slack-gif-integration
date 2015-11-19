var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var multer = require('multer');
var request = require('request');

var GOOGLE_CSE_KEY = ''; // Your Google developer API key
var GOOGLE_CSE_ID = ''; // The ID of your Custom Search Engine
var SLACK_TOKEN = ''; // The token from your slash integration

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post('/', function (req, res) {
  search = req.body['text'];

  if(req.body['token'] != SLACK_TOKEN) {
    res.send('ERROR: slack auth tokens did not match');
  } else if(GOOGLE_CSE_ID == '') {
    res.send('ERROR: Missing Google CSE ID');
  } else if(GOOGLE_CSE_KEY == '') {
    res.send('ERROR: Missing Google CSE Key');
  } else {
    q = {
      q: search,
      searchType: 'image',
      safe: 'high',
      fields: 'items(link)',
      fileType: 'gif',
      hq: 'animated',
      tbs: 'itp:animated',
      cx: GOOGLE_CSE_ID,
      key: GOOGLE_CSE_KEY
    }

    url = 'https://www.googleapis.com/customsearch/v1';

    var first = true;
    for(var k in q) {
      url += (first ? '?' : '&') + k + '=' + encodeURIComponent(q[k]);
      first = false;
    }

    request.get(url, function(error, response, body) {
      results = JSON.parse(body)['items'];

      image = results[Math.floor(Math.random()*results.length)]['link'];

      response = {
        response_type: "in_channel",
        attachments: [
          { fallback: search,
            image_url: image,
            title: '<' + image + '|' + search + '>'
          }
        ]
      };

      res.json(response);
    });
  }
});

var server = app.listen(3001, function () {
  var host = server.address().address;
  var port = server.address().port;
});
