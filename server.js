var express = require('express'),
    app = express(),
    bodyParser = require('body-parser'),
    multer = require('multer'),
    request = require('request'),
    fs = require('fs'),
    cheerio = require('cheerio'),
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

                  if (body.message != undefined) {
                    current_history.ts = body.message.ts;
                    current_history.channel = body.channel;
                  }

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

app.post('/reference', function(req, res){
  var original_search = req.body.text;
  var pretty_player_name = to_title_case(original_search);
  var search = original_search.toLowerCase().replace(/ /g , "+");
  var url = null;
  if (req.body.channel_name == "baseball") {
    url = "http://www.baseball-reference.com/player_search.cgi?search="+search;
  } else if (req.body.channel_name == "basketball") {
    url = "http://www.basketball-reference.com/search/search.fcgi?search="+search;
  } else {
    res.send("ERROR: Command not supported in this channel (only #baseball, #basketball)")
  }

  if (url != null) {
    request.get(url, function(error, response, body) {
      if(error) {
        res.send("ERROR: Unexpected error ¯\\_(ツ)_/¯");
      } else {

        //parse html page, pick out first link
        var $ = cheerio.load(body);
        var href = undefined;
        if (req.body.channel_name == "baseball") {
          if ($(".search_results a")["0"] != undefined) {
            href = "http://www.baseball-reference.com"+$(".search_results a")["0"]["attribs"]["href"];
          }
        } else if (req.body.channel_name == "basketball") {
          if (response.request.uri.href.indexOf("search") == -1) {
            href = response.request.uri.href;
          } else if ($("#players a")['0'] != undefined) {
            href = "http://www.basketball-reference.com"+$("#players a")['0']['attribs']['href'];
          }
        }

        if (href == undefined) {
          res.send("ERROR: No results");
          console.log("FAILURE: req.body.channel_name: "+req.body.channel_name);
        } else {
          client.query('SELECT t.token FROM tokens t WHERE t.username LIKE $1', [req.body.user_id], function(err, result) {
            var user_valid = result.rows[0] != undefined && result.rows.length > 0;

            if(user_valid) {
              var user_token = result.rows[0].token

              res.send('');
              var payload = {
                token: user_token,
                channel: req.body.channel_id,
                as_user: true,
                unfurl_links: true,
                text: "/reference "+original_search+"\n"+href
              }

              request.post('https://slack.com/api/chat.postMessage', {form: payload}, function(error, response, body) {
                if(error) {
                  post_text_to_url("ERROR: Unexpected error ¯\\_(ツ)_/¯", req.body.response_url);
                } else {
                  var body = JSON.parse(body);

                  if(body.error) {
                    post_text_to_url("ERROR: " + body.error, req.body.response_url);
                  }
                }
              });
            } else { // User not authed
              var response = {
                response_type: "in_channel",
                unfurl_links: true,
                text: href
              };

              res.json(response);
              post_text_to_url('<https://slack.com/oauth/authorize?scope=chat:write:user,commands&redirect_uri=' + process.env.HOST_URL + '&team=' + req.body.team_id + '&state=' + req.body.user_id + '&client_id=' + process.env.APP_CLIENT_ID + '|Please authenticate to allow inline responses. Click here to auth.>', req.body.response_url);
            }
          });
        }
      }
    });
  }
});

app.post('/compare', function(req, res){
  var original_search = req.body.text;

  //Get player names

  var words = original_search.split(' ');
  var player_1 = undefined;
  var player_2 = undefined;
  var player_1_id = undefined;
  var player_2_id = undefined;

  var player_id_regex = /(?=\w+\.\w{3,4}$)\w+/g;

  if (words.length == 2) {
    player_1 = words[0];
    player_2 = words[1];
  } else if (words.length == 4) {
    player_1 = words[0]+"+"+words[1];
    player_2 = words[2]+"+"+words[3];
  } else {
    res.send("Can only compare two players");
    return;
  }

  //Search for first player id
  var url = null;
  if (req.body.channel_name == "baseball") {
    // url = "http://www.baseball-reference.com/player_search.cgi?search="+search;
    res.send("ERROR: Command not supported in this channel (only #basketball)");
    return;
  } else if (req.body.channel_name == "basketball") {
    url = "http://www.basketball-reference.com/search/search.fcgi?search="+player_1;
  } else {
    res.send("ERROR: Command not supported in this channel (only #basketball)");
    return;
  }

  if (url != null) {
    request.get(url, function(error, response, body) {
      if(error) {
        res.send("ERROR: Unexpected error ¯\\_(ツ)_/¯");
        return;
      } else {

        //parse html page, pick out first link
        var $ = cheerio.load(body);
        if (req.body.channel_name == "baseball") {
          // if ($(".search_results a")["0"] != undefined) {
          //   var href  = $(".search_results a")["0"]["attribs"]["href"];
          //   player_1_id = $(".search_results a")["0"]["attribs"]["href"];
          // }
        } else if (req.body.channel_name == "basketball") {
          if (response.request.uri.href.indexOf("search") == -1) {
            var href = response.request.uri.href;
            var href_split = href.split("/");
            player_1_id = href_split[href_split.length-1].replace(".html","");
          }
          else if ($("#players a")['0'] != undefined) {
            var href = $("#players a")['0']['attribs']['href'];
            var href_split = href.split("/");
            player_1_id = href_split[href_split.length-1].replace(".html","");
          }
        }

        if (player_1_id == undefined) {
          res.send("ERROR: No results for player 1: "+player_1);
          return;
        } else {
          //Search for second player id
          url = null;
          if (req.body.channel_name == "baseball") {
            // url = "http://www.baseball-reference.com/player_search.cgi?search="+search;
            res.send("ERROR: Command not supported in this channel (only #basketball)");
            return;
          } else if (req.body.channel_name == "basketball") {
            url = "http://www.basketball-reference.com/search/search.fcgi?search="+player_2;
          } else {
            res.send("ERROR: Command not supported in this channel (only #basketball)");
            return;
          }

          request.get(url, function(error, response, body) {
            if(error) {
              res.send("ERROR: Unexpected error ¯\\_(ツ)_/¯");
              return;
            } else {

              //parse html page, pick out first link
              var $ = cheerio.load(body);
              if (req.body.channel_name == "baseball") {
                // if ($(".search_results a")["0"] != undefined) {
                //   var href  = $(".search_results a")["0"]["attribs"]["href"];
                //   player_1_id = $(".search_results a")["0"]["attribs"]["href"];
                // }
              } else if (req.body.channel_name == "basketball") {
                if (response.request.uri.href.indexOf("search") == -1) {
                  var href = response.request.uri.href;
                  var href_split = href.split("/");
                  player_2_id = href_split[href_split.length-1].replace(".html","");
                } else if ($("#players a")['0'] != undefined) {
                  var href = $("#players a")['0']['attribs']['href'];
                  var href_split = href.split("/");
                  player_2_id = href_split[href_split.length-1].replace(".html","");
                }
              }

              if (player_2_id == undefined) {
                res.send("ERROR: No results for player 2: "+player_2);
                return;
              } else {
                var final_url = null;
                if (req.body.channel_name == "baseball") {
                  // url = "http://www.baseball-reference.com/player_search.cgi?search="+search;
                  res.send("ERROR: Command not supported in this channel (only #basketball)");
                  return;
                } else if (req.body.channel_name == "basketball") {
                  final_url = "http://www.basketball-reference.com/play-index/pcm_finder.cgi?request=1&sum=0&player_id1="+player_1_id+"&y1=2017&player_id2="+player_2_id+"&y2=2017";
                } else {
                  res.send("ERROR: Command not supported in this channel (only #basketball)");
                  return;
                }

                client.query('SELECT t.token FROM tokens t WHERE t.username LIKE $1', [req.body.user_id], function(err, result) {
                  var user_valid = result.rows[0] != undefined && result.rows.length > 0;

                  if(user_valid) {
                    var user_token = result.rows[0].token

                    res.send('');
                    var payload = {
                      token: user_token,
                      channel: req.body.channel_id,
                      as_user: true,
                      unfurl_links: true,
                      text: "/compare "+original_search+"\n"+final_url
                    }

                    request.post('https://slack.com/api/chat.postMessage', {form: payload}, function(error, response, body) {
                      if(error) {
                        post_text_to_url("ERROR: Unexpected error ¯\\_(ツ)_/¯", req.body.response_url);
                      } else {
                        var body = JSON.parse(body);

                        if(body.error) {
                          post_text_to_url("ERROR: " + body.error, req.body.response_url);
                        }
                      }
                    });
                  } else { // User not authed
                    var response = {
                      response_type: "in_channel",
                      unfurl_links: true,
                      text: final_url
                    };

                    res.json(response);
                    post_text_to_url('<https://slack.com/oauth/authorize?scope=chat:write:user,commands&redirect_uri=' + process.env.HOST_URL + '&team=' + req.body.team_id + '&state=' + req.body.user_id + '&client_id=' + process.env.APP_CLIENT_ID + '|Please authenticate to allow inline responses. Click here to auth.>', req.body.response_url);
                  }
                });
              }
            }
          });
        }
      }
    });
  }
});

app.post('/last_game', function(req, res){
  res.send("");

  var original_search = req.body.text;
  var pretty_player_name = to_title_case(original_search);
  var search = original_search.toLowerCase().replace(/ /g , "+");
  var url = null;
  if (req.body.channel_name == "baseball") {
    // url = "http://www.baseball-reference.com/player_search.cgi?search="+search;
    request.post(process.env.SLACK_BASKETBALL_URL, {json: {text: "ERROR: Command not supported in this channel (only #basketball)"}});
  } else if (req.body.channel_name == "basketball") {
    url = "http://www.basketball-reference.com/search/search.fcgi?search="+search;
  } else {
    request.post(process.env.SLACK_BASKETBALL_URL, {json: {text: "ERROR: Command not supported in this channel (only #basketball)"}});
  }

  if (url != null) {
    request.get(url, function(error, response, body) {
      if(error) {
        request.post(process.env.SLACK_BASKETBALL_URL, {json: {text: "ERROR: Unexpected error ¯\\_(ツ)_/¯"}});
      } else {

        //parse html page, pick out first link
        var $ = cheerio.load(body);
        var href = undefined;
        if (req.body.channel_name == "baseball") {
          if ($(".search_results a")["0"] != undefined) {
            href = "http://www.baseball-reference.com"+$(".search_results a")["0"]["attribs"]["href"];
          }
        } else if (req.body.channel_name == "basketball") {
          if (response.request.uri.href.indexOf("search") == -1) {
            href = response.request.uri.href;
          } else if ($("#players a")['0'] != undefined) {
            href = "http://www.basketball-reference.com"+$("#players a")['0']['attribs']['href'];
          }
        }

        if (href == undefined) {
          request.post(process.env.SLACK_BASKETBALL_URL, {json: {text: "No results for "+original_search}});
        } else {
          href = href.replace(".html", "/gamelog/2017");
          request.get(href, function(error, response, body) {
            if(error) {
              request.post(process.env.SLACK_BASKETBALL_URL, {json: {text: "ERROR: Unexpected error ¯\\_(ツ)_/¯"}});
            } else {

              //parse html, find last row in game log table, construct pretty statline
              $ = cheerio.load(body);
              $row = $("#pgl_basic tr").last();
              $columns = $row.find("td");

              var date = $($columns[1]).text();
              var opponent = $($columns[5]).text();
              var minutes = $($columns[8]).text();
              var fg = $($columns[9]).text();
              var fga = $($columns[10]).text();
              var fgp = $($columns[11]).text();
              var threes = $($columns[12]).text();
              var threes_a = $($columns[13]).text();
              var threes_p = $($columns[14]).text();
              var ft = $($columns[15]).text();
              var fta = $($columns[16]).text();
              var ftp = $($columns[17]).text();
              var reb = $($columns[20]).text();
              var ast = $($columns[21]).text();
              var stl = $($columns[22]).text();
              var blk = $($columns[23]).text();
              var tov = $($columns[24]).text();
              var pts = $($columns[26]).text();

              var message = "*"+pretty_player_name+"*'s most recent game:\n"+
              ">>>*"+date+"* vs *"+opponent+"*\n"+
              "*MIN*: "+minutes+"\n"+
              "*PTS*: "+pts+" ("+fg+"/"+fga+", "+fgp+" *FG%*, "+threes+"/"+threes_a+" *3P*, "+ft+"/"+fta+" *FT*)\n"+
              "*REB*: "+reb+"\n"+
              "*AST*: "+ast+"\n"+
              "*STL*: "+stl+"\n"+
              "*BLK*: "+blk+"\n"+
              "*TO*: "+tov;

              request.post(process.env.SLACK_BASKETBALL_URL, {json: {text: message}});
            }
          });
        }
      }
    });
  }
});

app.post('/blurb', function(req, res){
  var original_search = req.body.text;
  var pretty_player_name = to_title_case(original_search);
  var search = original_search.toLowerCase().replace(/ /g , "+");
  var url = null;
  var first, last = null;


  var words = original_search.split(' ');
  if (words.length == 2) {
    first = words[0];
    last = words[1];
  }


  if (req.body.channel_name == "basketball") {
    url = "http://www.rotoworld.com/content/playersearch.aspx?searchname="+last+",%20"+first+"&sport=nba"
  } else if (req.body.channel_name == "baseball") {
    url = "http://www.rotoworld.com/content/playersearch.aspx?searchname="+last+",%20"+first+"&sport=mlb"
  } else {
    res.send("ERROR: Command not supported in this channel (only #baseball, #basketball)")
  }

  if (url != null) {
    request.get(url, function(error, response, body) {
      if(error) {
        res.send("ERROR: Unexpected error ¯\\_(ツ)_/¯");
      } else {

        //parse html page, get blurb
        var $ = cheerio.load(body);

        var $current_news = $($(".playernews")[0]);
        var blurb_header = $current_news.find(".report").text();
        var blurb_body = $current_news.find(".impact").text();

        if ($current_news.length == 0) {
          res.send("ERROR: No results");
          console.log("FAILURE: req.body.channel_name: "+req.body.channel_name);
        } else {
          res.send("");

          message = blurb_header+"\n\n"+
                "*Advice:* "+blurb_body;

          if (req.body.channel_name == "basketball") {
            request.post(process.env.SLACK_BASKETBALL_URL, {json: {text: message}});
          } else if (req.body.channel_name == "baseball") {
            request.post(process.env.SLACK_BASEBALL_URL, {json: {text: message}});
          }
        }
      }
    });
  }
});

var post_text_to_url = function(message, url) {
  request.post(url, {json: {text: message}})
}

var to_title_case = function(str) {
  return str.replace(/\w\S*/g, function(txt){return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();});
}

var server = app.listen(process.env.PORT || 3001, function () {
  var host = server.address().address;
  var port = server.address().port;
});
