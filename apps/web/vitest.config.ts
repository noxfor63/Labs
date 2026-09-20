import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  plugins: [react()],
  envDir: repoRoot,
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
  },
});
