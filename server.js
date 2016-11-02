var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    multer = require('multer'),
    request = require('request'),
    fs = require('fs'),
    history = {};

var pg = require('pg');
pg.defaults.ssl = true;
var client = new pg.Client(process.env.DATABASE_URL);
client.connect();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post('/', function (req, res) {
  var search = req.body['text'];
  var current_history = {};

  if(req.body['token'] != process.env.SLACK_TOKEN) {
    res.send('ERROR: Slack Auth Token did not match');
  } else if(process.env.GOOGLE_CSE_ID == '') {
    res.send('ERROR: Missing Google CSE ID');
  } else if(process.env.GOOGLE_CSE_KEY == '') {
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
      cx: process.env.GOOGLE_CSE_ID,
      key: process.env.GOOGLE_CSE_KEY
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
        } else if (body.items){
          var results = body.items;
          var image = results.splice(Math.floor(Math.random()*results.length),1)[0].link;

          current_history.images = results;
          current_history.search = search;

          client.query("SELECT t.token FROM tokens t WHERE t.username LIKE $1", [req.body.user_id], function(err, result) {
            if (err) {
              console.log("ERROR: " + err);
            }
            var user_valid = result.rows[0] != undefined && result.rows.length > 0;

            if(user_valid) {
              var user_token = result.rows[0].token;
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

                  current_history.ts = body.message.ts;
                  current_history.channel = body.channel;

                  if(body.error) {
                    post_text_to_url("ERROR: " + body.error, req.body.response_url);
                  } else {
                    if (history[req.body.user_id] === undefined) history[req.body.user_id] = {};
                    history[req.body['user_id']][req.body['channel_id']] = current_history;
                  }
                }
              });
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

              if (history[req.body.user_id] === undefined) history[req.body.user_id] = {};
              history[req.body['user_id']][req.body['channel_id']] = current_history;
              post_text_to_url('<https://slack.com/oauth/authorize?scope=chat:write:user,commands&redirect_uri=' + process.env.HOST_URL + '&team=' + req.body.team_id + '&state=' + req.body.user_id + '&client_id=' + process.env.APP_CLIENT_ID + '|Please authenticate to allow inline responses. Click here to auth.>', req.body.response_url);
            }
          });
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
    client_id: process.env.APP_CLIENT_ID,
    client_secret: process.env.APP_CLIENT_SECRET,
    redirect_uri: process.env.HOST_URL
  }

  var user_id = req.query.state;

  request.post('https://slack.com/api/oauth.access', {form: payload}, function(error, response, body) {
    console.log("slack auth respnse: "+response+ ", body: " + body)
    var body = JSON.parse(body);
    var token = body.access_token;

    client.query("INSERT INTO tokens (username, token) VALUES ($1, $2)", [user_id, token], function(err, result) {
      if (err) {
        console.log("Error when inserting token: "+err);
        res.send('Unexpected Error: ' + err);
      } else {
        console.log("Successfully inserted "+user_id);
        res.send('You are now authenticated, Thank you.');
      }
    });
  })
});

app.post('/rtd', function(req, res){
  if (history[req.body.user_id] === undefined) history[req.body.user_id] = {};
  var results = history[req.body.user_id][req.body.channel_id];

  if (results) {
    if (results.images.length == 0) {
      res.send("ERROR: No more unseen images.");
    } else {
      var image = results.images.splice(Math.floor(Math.random()*results.images.length),1)[0].link;

      client.query('SELECT t.token FROM tokens t WHERE t.username LIKE $1', [req.body.user_id], function(err, result) {
        var user_valid = result.rows[0] != undefined && result.rows.length > 0;

        if(user_valid) {
          var user_token = result.rows[0].token

          res.send('');
          var payload = {
            token: user_token,
            ts: results.ts,
            channel: results.channel,
            text: "/gif " + results.search,
            as_user: true,
            attachments: JSON.stringify([
              { fallback: results.search,
                image_url: image,
                title: '<' + image + '|' + results.search + '>'
              }
            ])
          }

          request.post('https://slack.com/api/chat.update', {form: payload}, function(error, response, body) {
            if(error) {
              post_text_to_url("ERROR: Unexpected error ¯\\_(ツ)_/¯", req.body.response_url);
              // TODO: Log the error
            } else {
              var body = JSON.parse(body);

              if(body.error) {
                post_text_to_url("ERROR: " + body.error, req.body.response_url);
              } else {
                history[req.body.user_id][req.body.channel_id] = results;
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
      });
    }
  } else {
    res.send("ERROR: No previous search found");
  }
});

var post_text_to_url = function(message, url) {
  request.post(url, {json: {text: message}})
}

var server = app.listen(process.env.PORT, function () {
  var host = server.address().address;
  var port = server.address().port;
});
