import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

import { PrismaClient } from '../../generated/prisma/client.ts';
import { env } from '../config/env.ts';

/**
 * В Prisma 7 клиент больше не открывает соединение сам: драйвер передаётся
 * явно через adapter. Пул один на процесс — создавать его на каждый запрос
 * нельзя, иначе быстро упрёмся в лимит соединений Postgres.
 */
const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/** Аккуратное закрытие: сначала клиент, затем пул. */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}
