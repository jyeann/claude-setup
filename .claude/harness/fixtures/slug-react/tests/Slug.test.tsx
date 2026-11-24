import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Slug } from '../src/Slug';
import { freshContainer, rendered, text, type } from './render';

let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); });

const input = () => document.querySelector<HTMLInputElement>('#title') as HTMLInputElement;

describe('<Slug />', () => {
  it('asks for a title before anything is typed', async () => {
    root = await rendered(() => { const r = createRoot(freshContainer()); r.render(<Slug />); return r; });
    expect(text('label')).toBe('Title');
    expect(text('[data-testid="slug"]')).toBe('Type a title to see its slug');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the slug of what is typed', async () => {
    root = await rendered(() => { const r = createRoot(freshContainer()); r.render(<Slug />); return r; });
    await type(input(), 'Hello React World');
    expect(input().value).toBe('Hello React World');
    expect(text('[data-testid="slug"]')).toBe('hello-react-world');
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('warns when the slug is longer than the limit', async () => {
    root = await rendered(() => { const r = createRoot(freshContainer()); r.render(<Slug />); return r; });
    await type(input(), 'word '.repeat(9));
    expect(text('[data-testid="slug"]')).toBe('word-word-word-word-word-word-word-word-word');
  });
});
