import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      enabled: false,
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      include: ['src/App.tsx', 'src/api.ts', 'src/photo.ts', 'src/wallet.ts'],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
      reportsDirectory: './coverage',
    },
  },
});
