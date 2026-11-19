'use strict';
const crypto = require('node:crypto');

const LIST_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const ITEM_ID_RE = /^[1-9][0-9]{0,9}$/;

// 16 random bytes -> 22 base64url characters, no padding.
function newListId() {
  return crypto.randomBytes(16).toString('base64url');
}

module.exports = { newListId, LIST_ID_RE, ITEM_ID_RE };
