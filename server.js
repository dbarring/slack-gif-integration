var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    multer = require('multer'),
    merge = require('merge'),
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
  if(req.body['token'] != secrets.SLACK_TOKEN) {
    res.send('ERROR: Slack Auth Token did not match');
  } else if(secrets.GOOGLE_CSE_ID == '') {
    res.send('ERROR: Missing Google CSE ID');
  } else if(secrets.GOOGLE_CSE_KEY == '') {
    res.send('ERROR: Missing Google CSE Key');
  } else if(tokens[req.body.user_id] == undefined) {
    res.send('<https://slack.com/oauth/authorize?scope=chat:write:user,chat:write:bot,commands&redirect_uri=' + secrets.HOST_URL + '/auth&team=' + req.body.team_id + '&state=' + req.body.user_id + '&client_id=' + secrets.APP_CLIENT_ID + '|Please click here to Authenticate to use this gif integration.>');
  } else {

    var session = (h = history[req.body.user_id]) === undefined ? {} : h;
    var command = req.body.text.split(" ")[0];

    switch(command) {
      case 'g':
      case 'get':
        res.send('');
        session = {};
        var helpers = helper_functions(session);

        helpers.set_response_url(req.body.response_url);
        session.command = command;
        session.search = req.body.text.replace(session.command + " ", "");

        helpers.find_images(function(body) {
          helpers.next_image();

          var payload = {
            token: tokens[req.body.user_id],
            channel: req.body.channel_id,
            text: helpers.message_text(),
            as_user: true,
            attachments: JSON.stringify(helpers.message_image_attachments())
          };

          request.post('https://slack.com/api/chat.postMessage', {form: payload}, function(error, response, body) {
            if(error) {
              helpers.post_text("ERROR: Unexpected error ¯\\_(ツ)_/¯");
              // TODO: Log the error
            } else {
              var body = JSON.parse(body);

              if(body.error) {
                helpers.post_text("ERROR: " + body.error);
              } else {
                session.ts = body.message.ts;
                session.channel = body.channel;
              }
            }
          })
        });
        break;
      case 'r':
      case 'rtd':
        res.send('');
        if (session) {
          var helpers = helper_functions(session);
          helpers.set_response_url(req.body.response_url);

          helpers.next_image();

          var payload = {
            text: helpers.message_text(),
            as_user: true,
            channel: session.channel,
            ts: session.ts,
            token: tokens[req.body.user_id],
            attachments: JSON.stringify(helpers.message_image_attachments())
          };

          request.post('https://slack.com/api/chat.update', {form: payload}, function(error, response, body) {
            if(error) {
              helpers.post_text("ERROR: Unexpected error ¯\\_(ツ)_/¯");
        // TODO: Log the error
            } else {
              var body = JSON.parse(body);

              if(body.error) {
                helpers.post_text("ERROR: " + body.error);
              }
            }
          });
        } else {
          helpers.post_text("ERROR: No previous search found");
        }
        break;
      case 'p':
      case 'pick':
        res.send('');

        if(session.previewed == true) {
          var helpers = helper_functions(session);
          helpers.set_response_url(req.body.response_url);

          var args = req.body.text.replace(session.command + " ", "");

          if(args.split(" ")[0] == "-i") {
            var i = parseInt(args.split(" ")[1]);
            if(i > session.past.length || i < 0 || isNaN(i)) {
              helpers.post_text("ERROR: selected index '"+ i +"' out of range");
              break;
            }
            session.past_index = i - 1;
          } else if(args.split(" ")[0] == "-c") {
            session.previewed = false;
            break;
          }

          var payload = {
            token: tokens[req.body.user_id],
            channel: req.body.channel_id,
            text: helpers.message_text(),
            as_user: true,
            attachments: JSON.stringify(helpers.message_image_attachments())
          };

          request.post('https://slack.com/api/chat.postMessage', {form: payload}, function(error, response, body) {
            if(error) {
              helpers.post_text("ERROR: Unexpected error ¯\\_(ツ)_/¯");
              // TODO: Log the error
            } else {
              var body = JSON.parse(body);

              if(body.error) {
                helpers.post_text("ERROR: " + body.error);
              } else {
                session.ts = body.message.ts;
                session.channel = body.channel;
                session.previewed = false;
              }
            }
          });
        } else {
          session = {};
          session.previewed = true;
          var helpers = helper_functions(session);

          helpers.set_response_url(req.body.response_url);
          session.command = command;
          session.search = req.body.text.replace(session.command + " ", "");

          helpers.find_images(function(body) {
            helpers.next_image();

            var payload = {
              // token: tokens[req.body.user_id],
              response_type: 'ephemeral',
              // channel: req.body.channel_id,
              // as_user: true,
              text: helpers.preview_text(),
              attachments: helpers.message_image_attachments()
            }

            request.post(session.response_url, {json: payload}, function(error, response, body) {
              if(error) {
                helpers.post_text("ERROR: Unexpected error ¯\\_(ツ)_/¯");
                // TODO: Log the error
              } else {

                // console.log(response);
                // console.log('body: ', body);
                // var body = JSON.parse(body);

                // if(body.error) {
                //   helpers.post_text("ERROR: " + body.error);
                // } else {
                //   session.ts = body.message.ts;
                //   session.channel = body.channel;
                // }
              }
            });

          });
        }

        break;
      case 'next':
        res.send('');
        var helpers = helper_functions(session);
        helpers.set_response_url(req.body.response_url);

        var args = req.body.text.replace(session.command + " ", "");
        var i = 1;

        if(args.split(" ")[0] == "-c") {
          i = parseInt(args.split(" ")[1]);
          if(i < 1 || isNaN(i)) {
            helpers.post_text("ERROR: selected count '"+ i +"' invalid");
            break;
          }
        }

        for(var c = 0; c < i; c++) {
          helpers.next_image();

          var payload = {
            response_type: 'ephemeral',
            text: helpers.preview_text(),
            attachments: helpers.message_image_attachments()
          }

          request.post(session.response_url, {json: payload}, function(error, response, body) {
            if(error) {
              helpers.post_text("ERROR: Unexpected error ¯\\_(ツ)_/¯");
              // TODO: Log the error
            } else {

            }
          })
        }

        break;
      case 'prev':
        res.send('');
        var helpers = helper_functions(session);
        helpers.set_response_url(req.body.response_url);
        helpers.prev_image();

        var payload = {
          response_type: 'ephemeral',
          text: helpers.preview_text(),
          attachments: helpers.message_image_attachments()
        }

        request.post(session.response_url, {json: payload}, function(error, response, body) {
          if(error) {
            helpers.post_text("ERROR: Unexpected error ¯\\_(ツ)_/¯");
            // TODO: Log the error
          } else {

          }
        })

        break;
      case 'help':
        res.send('```Usage:\n/gif <command> <argument>\n      get       query\n      rtd\n      pick      query\n      next\n      prev\n*  get: finds and returns a random gif based on your query\n*  rtd: modifies your last gif with a random image from your last query\n*  pick: finds gifs based on your query and returns a preview. A subsequent call will post the previewed image\n*  next: modifies your preview with the next gif of the results\n*  prev: modifies your preview with the previous result.```');
        break;
      default:
        res.send('ERROR: unrecognized command "' + command + '". Try "/gif help" for help');
    }
    history[req.body.user_id] = session;
  }
});

app.get('/auth', function(req, res){
  var payload = {
    code: req.query['code'],
    client_id: secrets.APP_CLIENT_ID,
    client_secret: secrets.APP_CLIENT_SECRET,
    redirect_uri: secrets.HOST_URL + '/auth'
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

// app.get('/prev', function(req, res) {
//   // if (history[body.user_id]) {
//   //   if(tokens[body.user_id]) {
//   //     prev_image(body.user_id);

//   //     request.post(url, {json: rtd_message_body(body)}, function(error, response, body) {

//   //     });
//   //   } else { // User not authed
//   //     session.post_text("ERROR: Authentication Required", history[body.user_id].response_url);
//   //   }
//   // } else {
//   //   session.post_text("ERROR: No previous search found", history[body.user_id].response_url);
//   // }
// });

// app.get('/next', function(req, res) {
//   // if (history[body.user_id]) {
//   //   if(tokens[body.user_id]) {
//   //     next_image(body.user_id);

//   //     request.post(url, {json: rtd_message_body(body)}, function(error, response, body) {

//   //     });
//   //   } else { // User not authed
//   //     session.post_text("ERROR: Authentication Required", history[body.user_id].response_url);
//   //   }
//   // } else {
//   //   post_text_to_url("ERROR: No previous search found", history[body.user_id].response_url);
//   // }
// });

// app.get('/select', function(req, res) {
//   if(history[req.query.user_id]) {
//     var payload = {
//       token: tokens[req.query.user_id],
//       ts: history[req.query.user_id].ts,
//       channel: history[req.query.user_id].channel,
//       text: "/gif " + history[req.query.user_id].search,
//       as_user: true,
//       attachments: JSON.stringify(message_image_attachments(req.query))
//     }

//     request.post('https://slack.com/api/chat.update', {form: payload}, function(error, response, body) {
//       if(error) {
//         post_text_to_url("ERROR: Unexpected error ¯\\_(ツ)_/¯", history[req.query.user_id].response_url);
//   // TODO: Log the error
//       } else {
//         var body = JSON.parse(body);

//         if(body.error) {
//           post_text_to_url("ERROR: " + body.error, history[req.query.user_id].response_url);
//         }
//       }
//     });
//   } else {
//     post_text_to_url("ERROR: " + body.error, history[req.query.user_id].response_url);
//   }
// });

var helper_functions = function(session) {
  var helpers = {}
  helpers.next_image = function() {
    if(session.past_index == session.past.length -1) {
      var index = Math.floor(Math.random() * session.images.length);
      var new_image = session.images.splice(index, 1)[0].link;

      session.past.push(new_image);
    }

    session.past_index += 1;
  }
  helpers.prev_image = function() {
    session.past_index -= 1;
  }
  helpers.set_response_url = function(url) {
    session.response_url = url;
    this.post_text = function(message) {
      request.post(url, {json: {text: message}});
    }
  }
  helpers.message_text = function() {
    return "/gif "+ session.command + " " + session.search;
  }
  helpers.preview_text = function() {
    return "PREVIEW ("+ (session.past_index+1) +"/"+ (session.images.length + session.past.length) +"): call '/gif pick' again to post. '/gif next' for next image";
  }
  helpers.message_image_attachments = function() {
    return [
      {
        fallback: session.search,
        image_url: session.past[session.past_index],
        title: '<' + session.past[session.past_index] + '|' + session.search + '>'
      }
    ];
  }
  helpers.find_images = function(callback) {
    var q = {
      q: session.search,
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
        this.post_text("ERROR: Unexpected error ¯\\_(ツ)_/¯");
  // TODO: Log the error
      } else {
        var body = JSON.parse(body);

        if(body.error) {
          this.post_text("ERROR: " + body.error.errors[0].message);
  // TODO: Log the error
        } else if(body.items){
          session.images = body.items;
          session.past = [];
          session.past_index = -1;
          callback(body);
        } else {
          this.post_text("ERROR: No results found");
        }
      }
    })
  }
  return helpers;
}

var server = app.listen(3001, function () {
  var host = server.address().address;
  var port = server.address().port;
});
