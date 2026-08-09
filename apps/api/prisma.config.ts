import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Prisma CLI запускается из apps/api, а .env лежит в корне монорепо.
config({ path: new URL('../../.env', import.meta.url) });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // В Prisma 7 defineConfig принимает только url и shadowDatabaseUrl —
    // отдельного directUrl больше нет. Поэтому для Neon в DATABASE_URL
    // нужна строка БЕЗ "-pooler": миграции берут advisory-локи,
    // а они привязаны к сессии и через пулер не работают.
    url: env('DATABASE_URL'),
  },
});
