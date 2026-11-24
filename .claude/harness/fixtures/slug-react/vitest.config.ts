import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Unit tests live in tests/. The holdout command points --dir at the hidden set instead, which may live outside
// the project (HARNESS_HIDDEN_DIR); Vitest only loads test files from outside the root with fs.strict off.
// This applies to test runs only: vite.config.ts (the dev server and the build) keeps Vite's defaults.
export default mergeConfig(viteConfig, defineConfig({
  test: {
    dir: 'tests',
    include: ['**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
  server: { fs: { strict: false } },
}));
