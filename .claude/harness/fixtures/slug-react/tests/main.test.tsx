import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { freshContainer, rendered, text } from './render';

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.resetModules();
});

describe('main entry', () => {
  it('mounts the app into #root when the page has one', async () => {
    freshContainer('root');
    await act(async () => { await import('../src/main'); });
    expect(text('label')).toBe('Title');
    expect(text('[data-testid="slug"]')).toBe('Type a title to see its slug');
  });

  it('mounts nothing when the page has no #root', async () => {
    freshContainer('elsewhere');
    await act(async () => { await import('../src/main'); });
    expect(document.querySelector('label')).toBeNull();
    expect(document.body.innerHTML).toBe('<div id="elsewhere"></div>');
  });

  it('mount() renders into the element it is given and refuses a missing one', async () => {
    const { mount } = await import('../src/main');
    const host = freshContainer();
    root = await rendered(() => mount(host));
    expect(host.querySelector('#title')).not.toBeNull();
    expect(() => mount(null)).toThrow('missing #root element');
  });
});
