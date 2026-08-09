import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

/**
 * Проверяет тело запроса схемой и подменяет req.body разобранным значением —
 * дальше по цепочке приходят уже приведённые к нужным типам данные.
 * Ошибку не ловим: ZodError долетит до errorHandler и станет 400.
 */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
}

/** То же самое для query-параметров. */
export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    // В Express 5 req.query — геттер без сеттера, поэтому разобранное
    // значение кладём отдельным полем.
    req.validatedQuery = schema.parse(req.query);
    next();
  };
}
