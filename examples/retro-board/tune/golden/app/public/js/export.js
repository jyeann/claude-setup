import { boardApi } from './api.js';
import { parseBoardPath } from './logic.js';
import { announcePolite, copyText, flashLabel, selectContents } from './live.js';

const $ = (id) => document.getElementById(id);
const route = parseBoardPath(window.location.pathname);

async function main() {
  const h1 = $('export-title');
  h1.focus();
  if (!route || !route.f) { fail(); return; }
  const back = $('back-to-board');
  back.href = `/b/${route.p}/f/${route.f}`;
  const api = boardApi(route.p, route.f);
  try {
    const [exp, board] = await Promise.all([api.exportMarkdown(), api.get()]);
    document.title = `Export: ${board.data.title} - Retro board`;
    show(exp.data);
  } catch {
    fail();
  }
}

function fail() {
  $('loading').hidden = true;
  $('export-error').hidden = false;
}

function show({ filename, markdown }) {
  const pre = $('export-preview');
  pre.textContent = markdown;
  pre.hidden = false;
  $('loading').hidden = true;
  $('export-actions').hidden = false;

  const link = $('download-markdown');
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  link.href = URL.createObjectURL(blob);
  link.download = filename || 'retro.md';

  const status = $('copy-status');
  const copy = $('copy-markdown');
  copy.addEventListener('click', async () => {
    if (await copyText(markdown)) {
      status.hidden = true;
      flashLabel(copy, 'Copied', 'Copy to clipboard');
      announcePolite('Markdown copied to clipboard');
    } else {
      const msg = 'Could not copy. Select the text and copy it by hand.';
      status.textContent = msg;
      status.hidden = false;
      announcePolite(msg);
      selectContents(pre);
    }
  });
}

main();
