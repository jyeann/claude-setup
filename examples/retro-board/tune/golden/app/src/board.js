'use strict';
const { DomainError, normalizeText, checkColumn } = require('./validation');

const MAX_VOTES = 3;
const MAX_CARDS = 200;
const MAX_VOTERS = 500;

// All mutators change `board` in place and return false when nothing changed.
// The store hands them a clone, so a throw leaves the committed board intact.

function createBoard(title, facHash, now = new Date()) {
  return { schema: 1, facHash, title, createdAt: now.toISOString(), closed: false, version: 1, nextId: 1, cards: [] };
}

const requireOpen = (board) => {
  if (board.closed) throw new DomainError('board_closed', 409, 'This retro is closed.');
};

const findCard = (board, id) => {
  const card = typeof id === 'string' && /^\d{1,15}$/.test(id) ? board.cards.find((c) => c.id === id) : undefined;
  if (!card) throw new DomainError('card_not_found', 404, 'That card was removed.');
  return card;
};

const votesUsed = (board, voter) => board.cards.reduce((n, c) => n + (c.voters.includes(voter) ? 1 : 0), 0);

function addCard(board, column, text, author, now = new Date()) {
  const col = checkColumn(column);
  const clean = normalizeText(text);
  requireOpen(board);
  if (board.cards.length >= MAX_CARDS) throw new DomainError('board_full', 409, 'This board is full.');
  board.cards.push({ id: String(board.nextId), column: col, text: clean, createdAt: now.toISOString(), author, voters: [] });
  board.nextId += 1;
}

// actor: {voter, facilitator}. Facilitators may delete on a closed board.
function deleteCard(board, id, actor) {
  const card = findCard(board, id);
  if (!actor.facilitator) {
    requireOpen(board);
    if (card.author !== actor.voter) throw new DomainError('not_author', 403, 'Only the author can delete this card.');
  }
  board.cards = board.cards.filter((c) => c !== card); // its voters get their votes back
}

function vote(board, id, voter) {
  const card = findCard(board, id);
  requireOpen(board);
  if (card.voters.includes(voter)) return false;
  if (votesUsed(board, voter) >= MAX_VOTES) throw new DomainError('no_votes_left', 409, 'You have no votes left.');
  const isNew = !board.cards.some((c) => c.voters.includes(voter));
  if (isNew) {
    const distinct = new Set();
    for (const c of board.cards) for (const v of c.voters) distinct.add(v);
    if (distinct.size >= MAX_VOTERS) throw new DomainError('board_full', 409, 'This board is full.');
  }
  card.voters.push(voter);
  return true;
}

function unvote(board, id, voter) {
  const card = findCard(board, id);
  requireOpen(board);
  const i = card.voters.indexOf(voter);
  if (i < 0) return false;
  card.voters.splice(i, 1);
  return true;
}

function setClosed(board, closed) {
  if (typeof closed !== 'boolean') throw new DomainError('bad_request', 400, 'closed must be true or false.');
  if (board.closed === closed) return false;
  board.closed = closed;
  return true;
}

// Never includes hashes, tokens or client ids.
function toView(board, { role, voter }) {
  return {
    title: board.title,
    role: role === 'facilitator' ? 'facilitator' : 'participant',
    closed: board.closed,
    version: board.version,
    maxVotes: MAX_VOTES,
    votesLeft: Math.max(0, MAX_VOTES - votesUsed(board, voter)),
    cards: board.cards.map((c) => ({
      id: c.id,
      column: c.column,
      text: c.text,
      votes: c.voters.length,
      voted: c.voters.includes(voter),
      own: c.author === voter,
      createdAt: c.createdAt,
    })),
  };
}

module.exports = {
  MAX_VOTES, MAX_CARDS, MAX_VOTERS, DomainError,
  createBoard, addCard, deleteCard, vote, unvote, setClosed, toView,
};
