'use strict';
const crypto = require('node:crypto');
const { render } = require('./greetings');
const { PersistError } = require('./store');
const { validateHelloBody, normalizeName, isPersonalised } = require('./validation');

const CORE_BODY = '{"message":"Hello World! Welcome to the API."}';
const MESSAGE = 'Hello World! Welcome to the API.';

// handle(parsedBody) -> { status, text } where text is the exact JSON response body.
function createHello({ store, signer, now = Date.now, randomBytes = crypto.randomBytes }) {
  return {
    handle(parsed) {
      if (!isPersonalised(parsed)) return { status: 200, text: CORE_BODY };
      const err = validateHelloBody(parsed);
      if (err) return { status: 400, text: JSON.stringify({ error: err }) };
      const name = normalizeName(parsed.name);
      const language = parsed.language === undefined ? 'en' : parsed.language;
      const tone = parsed.tone === undefined ? 'formal' : parsed.tone;
      const greeting = render(language, tone, name);
      const id = randomBytes(8).toString('hex');
      const date = new Date(now()).toISOString().slice(0, 10);
      const signature = signer.sign({ id, name, greeting, date });
      let counts;
      try {
        counts = store.recordHello(name, { id, name, greeting, language, date, signature });
      } catch (e) {
        if (!(e instanceof PersistError)) throw e;
        return { status: 500, text: '{"error":"could not save"}' };
      }
      const text = signer.toText({ id, name, greeting, date, signature });
      return {
        status: 200,
        text: JSON.stringify({ message: MESSAGE, greeting, name, language, tone, visit: counts.visit, streak: counts.streak, certificate: { id, date, signature, text } }),
      };
    },
  };
}

module.exports = { createHello, CORE_BODY };
