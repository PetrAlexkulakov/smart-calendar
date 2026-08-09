import crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

import { env } from '../../config/env.ts';
import { UnauthorizedError } from '../../lib/errors.ts';
import { prisma } from '../../lib/prisma.ts';

const REFRESH_TOKEN_BYTES = 32;
const DAY_MS = 24 * 60 * 60 * 1000;

export function signAccessToken(userId: string): string {
  return jwt.sign({}, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
  });
}

/** Возвращает id пользователя или бросает UnauthorizedError. */
export function verifyAccessToken(token: string): string {
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET);
  } catch {
    throw new UnauthorizedError('Токен недействителен или истёк');
  }

  if (typeof payload === 'string' || !payload.sub) {
    throw new UnauthorizedError('Токен повреждён');
  }
  return payload.sub;
}

/**
 * Refresh-токен — просто 32 случайных байта, а не JWT: его всё равно надо
 * сверять с базой ради отзыва, так что подписывать нечего.
 *
 * В базе лежит HMAC, а не сам токен. Утечка дампа тогда не даёт войти:
 * без секрета из окружения восстановить исходный токен нельзя.
 */
function hashRefreshToken(token: string): string {
  return crypto.createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
}

export async function issueRefreshToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
    },
  });

  return token;
}

/**
 * Обменивает refresh-токен на новую пару. Старый токен сразу гасится:
 * каждый живёт ровно одно использование.
 *
 * Если пришёл уже отозванный токен — значит им пользуется кто-то ещё
 * (например, копию украли), и мы гасим все живые сессии пользователя.
 */
export async function rotateRefreshToken(
  token: string,
): Promise<{ userId: string; refreshToken: string }> {
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashRefreshToken(token) },
  });

  if (!stored) {
    throw new UnauthorizedError('Сессия не найдена, войдите заново');
  }

  if (stored.revokedAt) {
    await revokeAllUserTokens(stored.userId);
    throw new UnauthorizedError('Сессия скомпрометирована, войдите заново');
  }

  if (stored.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError('Сессия истекла, войдите заново');
  }

  // Отзыв старого и выпуск нового — одной транзакцией, чтобы параллельные
  // запросы не смогли обменять один и тот же токен дважды.
  const refreshToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('hex');

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
      },
    }),
  ]);

  return { userId: stored.userId, refreshToken };
}

/** Гасит один токен. Неизвестный токен ошибкой не считается: выход должен быть идемпотентным. */
export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserTokens(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
