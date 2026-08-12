import type { Request } from 'express';
import type { ZodType } from 'zod';

/**
 * Разбор входных данных запроса.
 *
 * Раньше это были middleware, которые складывали результат обратно в req.
 * Проблема в том, что Express типизирует req.body, req.query и req.cookies
 * как any: обработчик получал данные без типов, и любое обращение к полю
 * было неявным приведением. Теперь схема разбирается прямо в обработчике
 * и возвращает значение с выведенным из неё типом.
 *
 * ZodError ловить не нужно — Express 5 доводит её до errorHandler,
 * который превращает её в 400 с разбором по полям.
 */
export function parseBody<T>(req: Request, schema: ZodType<T>): T {
  return schema.parse(req.body);
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  return schema.parse(req.query);
}

export function parseParams<T>(req: Request, schema: ZodType<T>): T {
  return schema.parse(req.params);
}

/** Значение cookie или undefined. Отдельно, потому что req.cookies — тоже any. */
export function getCookie(req: Request, name: string): string | undefined {
  const cookies: unknown = req.cookies;
  if (typeof cookies !== 'object' || cookies === null) {
    return undefined;
  }

  const value: unknown = (cookies as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
