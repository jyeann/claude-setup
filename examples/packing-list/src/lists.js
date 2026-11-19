'use strict';

const MAX_ITEMS = 200;
const MAX_NAME = 80;
const MAX_ITEM = 120;

class DomainError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}

const MESSAGES = {
  list_not_found: 'That link does not match any list. Check it for typos.',
  item_not_found: 'That item was removed.',
  list_full: `This list is full (${MAX_ITEMS} items)`,
  storage_full: 'Too many lists are stored.',
  storage_error: 'Could not save that change. Try again.',
};

function createList(id, name, now) {
  return { id, name, createdAt: new Date(now).toISOString(), nextItemId: 1, items: [] };
}

// Mutates `list`. `text` must already be validated.
function addItem(list, text) {
  if (list.items.length >= MAX_ITEMS) throw new DomainError('list_full', 409, MESSAGES.list_full);
  const item = { id: String(list.nextItemId), text, ticked: false };
  list.nextItemId += 1;
  list.items.push(item);
  return item;
}

function findItem(list, itemId) {
  const item = list.items.find((i) => i.id === itemId);
  if (!item) throw new DomainError('item_not_found', 404, MESSAGES.item_not_found);
  return item;
}

function setTicked(list, itemId, ticked) {
  const item = findItem(list, itemId);
  item.ticked = ticked;
  return item;
}

function removeItem(list, itemId) {
  const item = findItem(list, itemId);
  list.items.splice(list.items.indexOf(item), 1);
  return item;
}

function toView(list) {
  return {
    id: list.id,
    name: list.name,
    items: list.items.map((i) => ({ id: i.id, text: i.text, ticked: i.ticked })),
  };
}

module.exports = {
  MAX_ITEMS, MAX_NAME, MAX_ITEM, MESSAGES, DomainError,
  createList, addItem, setTicked, removeItem, toView,
};
