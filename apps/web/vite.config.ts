import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// .env лежит в корне монорепозитория — один файл на всё приложение.
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

export default defineConfig({
  plugins: [react()],
  envDir: repoRoot,
  // Хостинг VK Mini Apps раздаёт статику от корня выданного домена.
  base: './',
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
