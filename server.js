var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    multer = require('multer'),
    request = require('request'),
    fs = require('fs'),
    history = {},
    tokens = {},
    secrets = {};
try {
  secrets = JSON.parse(fs.readFileSync('secrets.json', 'utf8'));
} catch (e) {
  console.error("ALERT: secrets failed to load, please set up secrets.json");
}
try {
  tokens = JSON.parse(fs.readFileSync('tokens.json', 'utf8'));
} catch (e) {
  console.error("ALERT: tokens failed to load, please set up tokens.json");
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post('/', function (req, res) {
  var search = req.body['text'];
  var current_history = {};

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

          current_history.images = results;
          current_history.search = search;

          var image = results[Math.floor(Math.random()*results.length)].link;

          var user_token = tokens[req.body.user_id]

          if(user_token) {
            res.send('');
            var payload = {
              token: user_token,
              channel: req.body.channel_id,
              text: "/gif "+search,
              as_user: true,
              attachments: JSON.stringify([
                { fallback: search,
                  image_url: image,
                  title: '<' + image + '|' + search + '>'
                }
              ])
            }

            request.post('https://slack.com/api/chat.postMessage', {form: payload}, function(error, response, body) {
              if(error) {
                post_text_to_url("ERROR: Unexpected error ¯\\_(ツ)_/¯", req.body.response_url);
                // TODO: Log the error
              } else {
                var body = JSON.parse(body);

                if(body.error) {
                  post_text_to_url("ERROR: " + body.error.errors[0].message, req.body.response_url);
                } else {
                  post_text_to_url('', req.body.response_url);
                  history[req.body['user_id']] = current_history;
                }
              }
            })
          } else { // User not authed
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
            history[req.body['user_id']] = current_history;
            post_text_to_url('<https://slack.com/oauth/authorize?scope=chat:write:user,commands&team=' + req.body.team_id + '&state=' + req.body.user_id + '&client_id=' + secrets.APP_CLIENT_ID + '|Please authenticate to allow inline responses. Click here to auth.>', req.body.response_url);
          }
        } else {
          res.send("ERROR: No results found");
        }
      }
    });
  }
});

app.get('/auth', function(req, res){
  var payload = {
    code: req.query['code'],
    client_id: secrets.APP_CLIENT_ID,
    client_secret: secrets.APP_CLIENT_SECRET,
    redirect_uri: secrets.HOST_URL
  }

  var user_id = req.query.state;

  request.post('https://slack.com/api/oauth.access', {form: payload}, function(error, response, body) {
    var body = JSON.parse(body);
    tokens[user_id] = body.access_token;

    fs.writeFile('tokens.json', JSON.stringify(tokens), function(err) {
      if(err) {
        res.send('Unexpected Error: ' + err);
      } else {
        res.send('You are now authenticated, Thank you.');
      }
    })
  })
});

app.post('/rtd', function(req, res){
  var results = history[req.body.user_id];

  if (results) {
    var user_token = tokens[req.body.user_id]
    var image = results.images[Math.floor(Math.random()*results.images.length)].link;

    if(user_token) {
      res.send('');
      var payload = {
        token: user_token,
        channel: req.body.channel_id,
        text: "/gif " + results.search,
        as_user: true,
        attachments: JSON.stringify([
          { fallback: results.search,
            image_url: image,
            title: '<' + image + '|' + results.search + '>'
          }
        ])
      }

      request.post('https://slack.com/api/chat.postMessage', {form: payload}, function(error, response, body) {
        if(error) {
          post_text_to_url("ERROR: Unexpected error ¯\\_(ツ)_/¯", req.body.response_url);
          // TODO: Log the error
        } else {
          var body = JSON.parse(body);

          if(body.error) {
            post_text_to_url("ERROR: " + body.error.errors[0].message, req.body.response_url);
          } else {
            post_text_to_url('', req.body.response_url);
          }
        }
      })
    } else { // User not authed
      var response = {
        response_type: "in_channel",
        attachments: [
          { fallback: results.search,
            image_url: image,
            title: '<' + image + '|' + results.search + '>'
          }
        ]
      };

      res.json(response);
    }
  } else {
    res.send("ERROR: No previous search found");
  }
});

var post_text_to_url = function(message, url) {
  request.post(url, {json: {text: message}})
}

var server = app.listen(3001, function () {
  var host = server.address().address;
  var port = server.address().port;
});
