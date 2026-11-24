import { expect, test } from '@playwright/test';

// J1 from spec.md: a person types a title and sees its slug, and a warning once it is too long.
test('J1 typing a title shows its slug', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('slug')).toHaveText('Type a title to see its slug');
  await page.getByLabel('Title').fill('Hello React World');
  await expect(page.getByTestId('slug')).toHaveText('hello-react-world');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Title').fill('word '.repeat(9));
  await expect(page.getByRole('alert')).toHaveText('Slug is longer than 40 characters');
});
