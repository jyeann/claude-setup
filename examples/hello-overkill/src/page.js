'use strict';
// page.js: the whole single-page UI as one static HTML string (zero dependencies).
// Export shape (document for src/security.js):
//   module.exports = { html, styleHash, scriptHash }
//   html       string  full page, one <style> and one <script>, no inline handlers/style attributes
//   styleHash  string  CSP source token, quoted and ready to use: 'sha256-<base64>' (of the <style> body)
//   scriptHash string  CSP source token, quoted and ready to use: 'sha256-<base64>' (of the <script> body)
// The parts live in src/page/: tokens (colour), geometry (certificate art), icons, style, markup, script.
// All dynamic text is written with textContent; the script never builds markup from strings.
const crypto = require('node:crypto');
const { STYLE } = require('./page/style');
const { BODY } = require('./page/markup');
const { SCRIPT } = require('./page/script');

const hash = (s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F4EEE2">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#12161C">
<title>Hello Overkill</title>
<style>${STYLE}</style>
</head>
<body>
${BODY}
<script>${SCRIPT}</script>
</body>
</html>
`;

module.exports = { html, styleHash: hash(STYLE), scriptHash: hash(SCRIPT) };
