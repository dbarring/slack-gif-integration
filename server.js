var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    multer = require('multer'),
    request = require('request'),
    fs = require('fs'),
    secrets = {};
try {
  secrets = JSON.parse(fs.readFileSync('secrets.json', 'utf8'));
} catch (e) {
  console.error("ALERT: secrets failed to load, please set up secrets.json");
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post('/', function (req, res) {
  var search = req.body['text'];

  if(req.body['token'] != secrets.SLACK_TOKEN) {
    res.send('ERROR: Slack Auth Token did not match');
  } else if(secrets.GOOGLE_CSE_ID == '') {
    res.send('ERROR: Missing Google CSE ID');
  } else if(secrets.GOOGLE_CSE_KEY == '') {
    res.send('ERROR: Missing Google CSE Key');
  } else {
    var q = {
      q: search,
      searchType: 'image',
      safe: 'high',
      fields: 'items(link)',
      fileType: 'gif',
      hq: 'animated',
      tbs: 'itp:animated',
      cx: secrets.GOOGLE_CSE_ID,
      key: secrets.GOOGLE_CSE_KEY
    }

    var url = 'https://www.googleapis.com/customsearch/v1';

    var first = true;
    for(var k in q) {
      url += (first ? '?' : '&') + k + '=' + encodeURIComponent(q[k]);
      first = false;
    }

    request.get(url, function(error, response, body) {
      if(error) {
        res.send("ERROR: Unexpected error ¯\\_(ツ)_/¯");
        // TODO: Log the error
      } else {
        var body = JSON.parse(body);

        if(body.error) {
          res.send("ERROR: " + body.error.errors[0].message);
          // TODO: Log the error
        } else if(body.items){
          var results = body.items;

          var image = results[Math.floor(Math.random()*results.length)].link;

          var response = {
            response_type: "in_channel",
            attachments: [
              { fallback: search,
                image_url: image,
                title: '<' + image + '|' + search + '>'
              }
            ]
          };

          res.json(response);
        } else {
          res.send("ERROR: No results found");
        }
      }
    });
  }
});

var server = app.listen(3001, function () {
  var host = server.address().address;
  var port = server.address().port;
});
