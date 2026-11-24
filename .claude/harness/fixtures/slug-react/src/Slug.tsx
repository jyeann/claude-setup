import { useState } from 'react';

export const MAX_SLUG_LENGTH = 40;

// Lower-case, accents removed, every run of other characters becomes one "-", no "-" at either end.
export function slugify(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isLong(slug: string, max: number = MAX_SLUG_LENGTH): boolean {
  return slug.length > max;
}

export function Slug() {
  const [title, setTitle] = useState('');
  const slug = slugify(title);
  return (
    <main>
      <label htmlFor="title">Title</label>
      <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <p data-testid="slug">{slug === '' ? 'Type a title to see its slug' : slug}</p>
      {isLong(slug) && <p role="alert">Slug is longer than {MAX_SLUG_LENGTH} characters</p>}
    </main>
  );
}
