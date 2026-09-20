import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, env } from 'prisma/config';

// Prisma CLI не читает .env сам, поэтому подтягиваем корневой файл
// встроенным загрузчиком Node — без дополнительных зависимостей.
const here = path.dirname(fileURLToPath(import.meta.url));
for (const candidate of [path.join(here, '.env'), path.join(here, '..', '..', '.env')]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

export default defineConfig({
  schema: path.join(here, 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join(here, 'prisma', 'migrations'),
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
