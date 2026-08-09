import { config } from 'dotenv';
import { z } from 'zod';

// .env лежит в корне монорепо, а процесс стартует из apps/api —
// поэтому путь считаем от расположения этого файла, а не от cwd.
config({ path: new URL('../../../../.env', import.meta.url) });

/**
 * Секреты помечены как optional намеренно: на текущем этапе сервер должен
 * подниматься с пустым .env. Как только появится аутентификация (этап 2)
 * и push (этап 6), соответствующие поля станут обязательными.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),

  DATABASE_URL: z.string().optional(),
  /** Соединение в обход пула — нужно только Prisma CLI для миграций. */
  DIRECT_DATABASE_URL: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().optional(),
  JWT_REFRESH_SECRET: z.string().optional(),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(корень)'}: ${issue.message}`)
    .join('\n');
  console.error(`Некорректные переменные окружения:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;

export const isDev = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';
