// server.js
// where your node app starts

// init project
const express = require('express');
const ApiAiAssistant = require('actions-on-google').ApiAiAssistant;
const bodyParser = require('body-parser');
const request = require('request');
const rp = require('request-promise-native');
const Rx = require('rxjs');
const app = express();
const Map = require('es6-map');

// Pretty JSON output for logs
const prettyjson = require('prettyjson');
// Join an array of strings into a sentence
// https://github.com/epeli/underscore.string#tosentencearray-delimiter-lastdelimiter--string
const toSentence = require('underscore.string/toSentence');

app.use(bodyParser.json({ type: 'application/json' }));

// This boilerplate uses Express, but feel free to use whatever libs or frameworks
// you'd like through `package.json`.

// http://expressjs.com/en/starter/static-files.html
app.use(express.static('public'));

// http://expressjs.com/en/starter/basic-routing.html
app.get("/", function (request, response) {
  response.sendFile(__dirname + '/views/index.html');
});

// Uncomment the below function to check the authenticity of the API.AI requests.
// See https://docs.api.ai/docs/webhook#section-authentication
/*app.post('/', function(req, res, next) {
  // Instantiate a new API.AI assistant object.
  const assistant = new ApiAiAssistant({request: req, response: res});
  
  // Throw an error if the request is not valid.
  if(assistant.isRequestFromApiAi(process.env.API_AI_SECRET_HEADER_KEY, 
                                  process.env.API_AI_SECRET_HEADER_VALUE)) {
    next();
  } else {
    console.log('Request failed validation - req.headers:', JSON.stringify(req.headers, null, 2));
    
    res.status(400).send('Invalid request');
  }
});*/

// Handle webhook requests
app.post('/', function (req, res, next) {
  // Log the request headers and body, to aide in debugging. You'll be able to view the
  // webhook requests coming from API.AI by clicking the Logs button the sidebar.
  // logObject('Request headers: ', req.headers);
  // logObject('Request body: ', req.body);

  // Instantiate a new API.AI assistant object.
  const assistant = new ApiAiAssistant({ request: req, response: res });

  // Declare constants for your action and parameter names
  const WELCOME_INPUT = 'input.welcome';
  const COUNT_NUM = 'count.number';
  const COUNT_TOTAL = 'count.totalAmount';
  const CREATE_SPEND = 'create.spend';
  const CREATE_SEPND_YES = 'create.spend.createspendmoneyforthem-yes';

  function welcome(assistant) {
    assistant.ask('Welcome to my Wolff agent!')
  }

  function countNumber(assistant) {
    let file = assistant.getArgument('file');
    let category = assistant.getArgument('category');

    request('http://54.69.169.144:5001/api/v1/workingNotes', function (error, response) {
      if (error) {
        next(error);
      } else {
        let body = JSON.parse(response.body);
        const count = body.reduce(function (acc, cur) {

          if (cur.tags.find(function (tag) {
              return (tag.subject === 'categories' && tag.value === category);
            })) {
            acc = acc + cur.files.length;
          }

          return acc;
        }, 0);

        assistant.ask('You have ' + count + ' ' + file + ' for ' + category);
      }
    });
  }

  function countTotal(assistant) {
    assistant.ask('count total!')
  }

  function createSpend(assistant) {
    let getCountOfReceiptCategoryContext = assistant.getContext('getcountofreceiptcategory-followup');
    let count = 0;
    request('http://54.69.169.144:5001/api/v1/workingNotes', function (error, response) {
      if (error) {
        next(error);
      } else {
        let body = JSON.parse(response.body);
        count = body.reduce(function (acc, cur) {

          if (cur.tags.find(function (tag) {
              return (tag.subject === 'categories' && tag.value === getCountOfReceiptCategoryContext.category);
            })) {
            acc = acc + cur.files.length;
          }

          return acc;
        }, 0);
        const googleRichResponse = assistant.buildRichResponse()
          .addSimpleResponse('Are you sure you want to create ' + count + ' spend monies?')
          .addSuggestions(
            ['Yes', 'No'])
          // Create a basic card and add it to the rich response
          .addBasicCard(assistant.buildBasicCard('Are you sure you want to create ' + count + ' spend monies?') // Note the two spaces before '\n' required for a
          // line break to be rendered in the card
            .setTitle('Create Spend Monies')
            .setImage('https://www.xero.com/content/dam/xero/images/features/expenses/features-illustrations-mobile-reciept.svg',
              'Picture of receipt'));
        assistant.ask(googleRichResponse)
      }
    });

  }

  function createSpendYes(assistant) {
    let getCountOfReceiptCategoryContext = assistant.getContext('getcountofreceiptcategory-followup');
    request('http://54.69.169.144:5001/api/v1/workingNotes', function (error, response) {
      if (error) {
        next(error);
      } else {
        let body = JSON.parse(response.body);
        const targetedDocuments = body.reduce(function (acc, cur) {

          if (cur.tags.find(function (tag) {
              return (tag.subject === 'categories' && tag.value === getCountOfReceiptCategoryContext.category);
            })) {
            const targetedDocument = cur.notes.find(function (note) {
              return note.name === 'targetedDocument';
            });
            if (targetedDocument) acc.push(targetedDocument);
          }
          return acc;
        }, []);
        targetedDocumentReqs = targetedDocuments.map(function (doc) {
          return (Rx.Observable.defer(
            function () {
              return rp({
                method: 'POST',
                uri: 'http://54.69.169.144:5000/api/v1/bff/xeroDraftDocument',
                body: doc.value,
                json: true // Automatically stringifies the body to JSON
              })
                .then(function (body) {
                  return body;
                });
            }
          ))
        });
        const createDocsSource = Rx.Observable.forkJoin(targetedDocumentReqs);
        const subscribe = createDocsSource.subscribe(
          function (result) {
            res.json(result);
          },
          function (err) {
            res.json({ error: err });
          },
          function () {
          });
      }
    });
  }

  let actionRouter = new Map();
  actionRouter.set(WELCOME_INPUT, welcome);
  actionRouter.set(COUNT_NUM, countNumber);
  actionRouter.set(COUNT_TOTAL, countTotal);
  actionRouter.set(CREATE_SPEND, createSpend);
  actionRouter.set(CREATE_SEPND_YES, createSpendYes);

  // Route requests to the proper handler functions via the action router.
  assistant.handleRequest(actionRouter);
});

// Handle errors.
app.use(function (err, req, res, next) {
  console.error(err.stack)
  res.status(500).send('Something broke!')
})

// Pretty print objects for logging.
function logObject(message, object, options) {
  console.log(message);
  console.log(prettyjson.render(object, options));
}

// Listen for requests.
let server = app.listen(3000, function () {
  console.log('Your app is listening on port ' + server.address().port);
});

