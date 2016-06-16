var express = require('express');
var fs = require('fs');
var request = require('request');
var cheerio = require('cheerio');
var app     = express();
var sendgrid = require('sendgrid').SendGrid(process.env.SENDGRID_API_KEY);
var url = require('url');
var redis = require('redis');
var client = redis.createClient();
var schedule = require('node-schedule');

var runScheduler = function() {
  // Once per minute:
  rule =   '* * * * *'
  //      ┬ ┬ ┬ ┬ ┬ ┬
  //      │ │ │ │ │ |
  //      │ │ │ │ │ └ day of week (0 - 7) (0 or 7 is Sun)
  //      │ │ │ │ └── month (1 - 12)
  //      │ │ │ └──── day of month (1 - 31)
  //      │ │ └────── hour (0 - 23)
  //      │ └──────── minute (0 - 59)
  //      └────────── second (0 - 59, OPTIONAL)

  // Kick off the job
  var job = schedule.scheduleJob(rule, function() {
    getDeals(function(){
      console.log("Scheduled process completed");
    });
  });

  console.log("Scheduler running...");
};

var getDeals = function(callback) {
  var requestUrl = 'http://www.dealzon.com/home-theater/hdtvs?screen-size=60',
      minSize = parseFloat(process.env.MIN_SIZE),
      maxPrice = parseFloat(process.env.MAX_PRICE),
      parsedUrl = url.parse(requestUrl),
      domain = parsedUrl.protocol + "//" + parsedUrl.host;

  request(requestUrl, function(error, response, html){
    if(!error) {
      var $ = cheerio.load(html);

      var json = [],
          $lis = $('ol.stream').find('li'),
          total = $lis.length,
          processed = 0;

      var incProcessed = function() {
        processed ++;
        if (processed == total) {
          notify();
        }
      };

      var notify = function() {
        if (json.length) {
          var helper = require('sendgrid').mail,
              from_email = new helper.Email(process.env.EMAIL_FROM),
              to_email = new helper.Email(process.env.EMAIL_TO),
              subject = "New Steve & Kevin TV Deal Alert",
              content = new helper.Content("text/plain", json.map(function(obj) { return "Size: " + obj.size + "\", Regular Price: $" + obj.regularPrice + ", Price: $" + obj.price + ", Store: " + obj.location + ", Link: " + obj.link + ", Title: " + obj.title; }).join('\n\n')),
              mail = new helper.Mail(from_email, subject, to_email, content),
              requestBody = mail.toJSON(),
              request = sendgrid.emptyRequest();

          request.method = 'POST';
          request.path = '/v3/mail/send';
          request.body = requestBody;

          sendgrid.API(request, function (response) {
            console.log("Sent email", response.statusCode, content);
          })
        }

        callback(html);
      }

      $lis.each(function(){
        var $li = $(this),
            $a = $li.find('h2').find('a'),
            title = $a.text(),
            path = $a.attr('href'),
            link = domain + path,
            text = $li.find('.byline_meta').text(),
            size = parseFloat(text.match(/(.+)" Display/)[1]),
            regularPrice = parseFloat($li.find('.strike_price').text().match(/\$(.+)/)[1].replace(',','')),
            price = parseFloat($li.find('.price').text().match(/\$(.+)/)[1].replace(',','')),
            location = $li.find('.section_2').text().match(/at (.+)/)[1],
            expired = $li.hasClass('expired_styling');

        if (size >= minSize && price <= maxPrice && !expired) {
          client.get(link, function(err, data) {
            // data is null if the key doesn't exist
            if (err || data === null) {
              console.log("New deal for " + link)
              client.set(link, title, redis.print);
              json.push({"size": size, "regularPrice": regularPrice, "price": price, "location": location, "expired": expired, "link": link, "title": title});
            } else {
              console.log("Deal for " + link + " was already emailed")
            }

            incProcessed();
          });
        } else {
          incProcessed();
        }
      });
    }
  });
};

app.get('/scrape', function(req, res){
  getDeals(function(html) {
    res.send(html)
  });
})

var port = process.env.PORT || 3000;
app.listen(port)
console.log("HTTP app running on port: " + port + ". Visit /scrape to manually run scraper process.");
exports = module.exports = app;

runScheduler();
