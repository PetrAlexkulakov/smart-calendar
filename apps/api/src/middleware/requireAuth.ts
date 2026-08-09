import type { Request, RequestHandler } from 'express';

import { UnauthorizedError } from '../lib/errors.ts';
import { verifyAccessToken } from '../modules/auth/tokens.ts';

const BEARER_PREFIX = 'Bearer ';

/** Пропускает запрос дальше, только если в заголовке валидный access-токен. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;

  if (!header?.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedError('Отсутствует заголовок Authorization');
  }

  req.user = { id: verifyAccessToken(header.slice(BEARER_PREFIX.length)) };
  next();
};

/**
 * Достаёт id пользователя из запроса, прошедшего requireAuth.
 * Нужен, чтобы обработчики не разбирались с необязательным req.user
 * и не подставляли userId из тела запроса — иначе легко получить доступ
 * к чужим данным.
 */
export function getUserId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError('Маршрут требует requireAuth');
  }
  return req.user.id;
}
