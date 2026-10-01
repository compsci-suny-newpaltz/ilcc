import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
    fileParallelism: false,          // one sqlite file per run; keep tests serial
    coverage: {
      reporter: ['text', 'lcov'],
      include: ['src/**'],
      exclude: ['src/reference/**', 'src/demos/**'],
    },
  },
});
