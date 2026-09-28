import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Корневой .env тестам не нужен, а Vite вытащил бы из него NODE_ENV
// бэкенда — см. комментарий в vite.config.ts.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
  },
});
