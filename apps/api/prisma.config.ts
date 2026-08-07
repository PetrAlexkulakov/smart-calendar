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
    url: env('DATABASE_URL'),
  },
});
