import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'proxy/**/*.test.js'],
    environment: 'node',
  },
});
