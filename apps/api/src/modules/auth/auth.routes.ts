import type { AuthResponse } from '@smart-calendar/shared';
import { loginSchema, registerSchema } from '@smart-calendar/shared';
import type { Response } from 'express';
import { Router } from 'express';

import { env } from '../../config/env.ts';
import { UnauthorizedError } from '../../lib/errors.ts';
import { getUserId, requireAuth } from '../../middleware/requireAuth.ts';
import { getCookie, parseBody } from '../../middleware/validate.ts';
import * as authService from './auth.service.ts';
import { revokeRefreshToken, rotateRefreshToken, signAccessToken } from './tokens.ts';

const REFRESH_COOKIE = 'refreshToken';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Refresh-токен живёт в httpOnly-cookie: JavaScript до неё не дотянется,
 * поэтому XSS не сможет её украсть. Access-токен, наоборот, отдаётся в теле
 * и хранится только в памяти вкладки.
 *
 * sameSite: 'lax' достаточно, потому что в разработке фронт и API общаются
 * через прокси Vite (один origin), а в проде будут на одном домене.
 */
function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * DAY_MS,
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.register(
    parseBody(req, registerSchema),
  );

  setRefreshCookie(res, refreshToken);
  res.status(201).json({ user, accessToken } satisfies AuthResponse);
});

authRouter.post('/login', async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.login(parseBody(req, loginSchema));

  setRefreshCookie(res, refreshToken);
  res.json({ user, accessToken } satisfies AuthResponse);
});

/** Обменивает refresh-cookie на новый access-токен и новую cookie. */
authRouter.post('/refresh', async (req, res) => {
  const token = getCookie(req, REFRESH_COOKIE);
  if (!token) {
    throw new UnauthorizedError('Нет refresh-токена');
  }

  const { userId, refreshToken } = await rotateRefreshToken(token);
  const user = await authService.getUserById(userId);

  setRefreshCookie(res, refreshToken);
  res.json({ user, accessToken: signAccessToken(userId) } satisfies AuthResponse);
});

authRouter.post('/logout', async (req, res) => {
  const token = getCookie(req, REFRESH_COOKIE);
  if (token) {
    await revokeRefreshToken(token);
  }

  // Отвечаем успехом в любом случае: выход не должен падать из-за того,
  // что сессия уже была завершена.
  clearRefreshCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({ user: await authService.getUserById(getUserId(req)) });
});
