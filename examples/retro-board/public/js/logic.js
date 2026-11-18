// Pure helpers shared by the pages. No DOM access here so Node can import this file in a unit test.

export const MAX_CARD = 500;
export const MAX_TITLE = 100;
export const COLUMNS = [
  { key: 'went-well', label: 'Went well', hint: 'Nothing here yet. What went well this sprint?' },
  { key: 'to-improve', label: 'To improve', hint: 'Nothing here yet. What should we do better?' },
  { key: 'actions', label: 'Actions', hint: 'Nothing here yet. What will we do about it?' },
];

export const columnLabel = (key) => (COLUMNS.find((c) => c.key === key) || { label: key }).label;

// Length in code points, the same unit the server uses.
export const codePointLength = (s) => Array.from(String(s)).length;

export function votesLeftLabel(n) {
  if (n <= 0) return 'No votes left';
  return n === 1 ? '1 vote left' : `${n} votes left`;
}

export function counterText(length) {
  return length > MAX_CARD ? `Over by ${length - MAX_CARD}` : `${length} / ${MAX_CARD}`;
}

export const emptyCardMessage = () => 'Write something before adding the card.';
export const tooLongMessage = (length) =>
  `That card is ${length} characters. The limit is ${MAX_CARD}. Shorten it by ${length - MAX_CARD}.`;

// Returns an error message, or '' when the text can be sent.
export function validateCardText(text) {
  const clean = String(text).trim();
  if (!clean) return emptyCardMessage();
  const n = codePointLength(clean);
  return n > MAX_CARD ? tooLongMessage(n) : '';
}

export function validateTitle(title) {
  const clean = String(title).trim();
  if (!clean) return 'Give your retro a title, for example Sprint 12.';
  return codePointLength(clean) > MAX_TITLE ? 'Keep the title to 100 characters or fewer.' : '';
}

export const voteButtonLabel = (voted, text) => {
  const short = Array.from(String(text)).slice(0, 40).join('').replace(/\s+/g, ' ');
  return voted ? `Remove your vote from: ${short}` : `Vote for: ${short}`;
};

export const newCardsMessage = (n) => `${n} new ${n === 1 ? 'card' : 'cards'} from others`;
export const removedCardsMessage = (n) => `${n} ${n === 1 ? 'card' : 'cards'} removed`;

// Highest votes first, ties keep the older (lower numeric id) card first.
export function compareByVotes(a, b) {
  if (b.votes !== a.votes) return b.votes - a.votes;
  return Number(a.id) - Number(b.id);
}
export const compareByAge = (a, b) => Number(a.id) - Number(b.id);

export function sortCards(cards, byVotes) {
  return cards.slice().sort(byVotes ? compareByVotes : compareByAge);
}

// Compare the cards we show with a fresh list. `ownIds` are excluded from "from others".
export function diffCards(prevCards, nextCards) {
  const prev = new Set(prevCards.map((c) => c.id));
  const next = new Set(nextCards.map((c) => c.id));
  return {
    added: nextCards.filter((c) => !prev.has(c.id)),
    removed: prevCards.filter((c) => !next.has(c.id)),
  };
}

// Messages for a poll that changed the board, in a fixed order. Own cards are never "from others".
export function pollAnnouncements(prevView, nextView) {
  const out = [];
  const { added, removed } = diffCards(prevView.cards, nextView.cards);
  const fromOthers = added.filter((c) => !c.own).length;
  if (fromOthers) out.push(newCardsMessage(fromOthers));
  if (removed.length) out.push(removedCardsMessage(removed.length));
  if (prevView.closed !== nextView.closed) out.push(nextView.closed ? 'This retro is closed.' : 'The retro is open again.');
  return out;
}

// Poll delay: 3 s normally, then 3, 6 and 10 s after consecutive failures. Retry-After (seconds) may raise it.
export function nextDelay(failures, retryAfterSeconds = 0) {
  const steps = [3000, 6000, 10000];
  const base = failures <= 0 ? 3000 : steps[Math.min(failures, steps.length) - 1];
  const asked = Number.isFinite(retryAfterSeconds) ? Math.max(0, retryAfterSeconds) * 1000 : 0;
  return Math.max(base, Math.min(asked, 60000));
}

export function parseBoardPath(pathname) {
  const m = /^\/b\/([A-Za-z0-9_-]+)(?:\/f\/([A-Za-z0-9_-]+))?(\/export)?\/?$/.exec(pathname);
  if (!m) return null;
  return { p: m[1], f: m[2] || null, isExport: Boolean(m[3]) };
}
