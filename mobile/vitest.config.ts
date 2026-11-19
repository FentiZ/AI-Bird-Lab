import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['App.tsx', 'src/client.ts'],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
      reportsDirectory: './coverage',
    },
  },
});
