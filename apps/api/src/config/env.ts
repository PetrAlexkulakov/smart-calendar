import { config } from 'dotenv';
import { z } from 'zod';

// .env лежит в корне монорепо, а процесс стартует из apps/api —
// поэтому путь считаем от расположения этого файла, а не от cwd.
config({ path: new URL('../../../../.env', import.meta.url) });

/**
 * Всё, без чего сервер не имеет смысла, объявлено обязательным: лучше
 * не подняться на старте с внятным сообщением, чем упасть на первом
 * запросе. Ключи VAPID пока опциональны — они нужны только push-этапу.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'нужна строка подключения к Postgres'),

  // 32 байта энтропии в hex. Сгенерировать:
  // node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  JWT_ACCESS_SECRET: z.string().min(32, 'секрет слишком короткий, нужно минимум 32 символа'),
  JWT_REFRESH_SECRET: z.string().min(32, 'секрет слишком короткий, нужно минимум 32 символа'),
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
