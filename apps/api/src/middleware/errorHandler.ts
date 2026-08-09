import type { ApiErrorResponse } from '@smart-calendar/shared';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

import { env } from '../config/env.ts';
import { AppError } from '../lib/errors.ts';

/** Ответ на неизвестный маршрут — тем же форматом, что и все ошибки. */
export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorResponse = {
    error: { code: 'NOT_FOUND', message: `Маршрут ${req.method} ${req.path} не существует` },
  };
  res.status(404).json(body);
};

/** Zod-ошибку приводим к виду «поле → список сообщений». */
function formatZodIssues(error: ZodError): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

/**
 * Единственное место, где ошибка превращается в HTTP-ответ.
 * Express 5 сам ловит отклонённые промисы из async-обработчиков
 * и доводит их сюда, так что оборачивать роуты в try/catch не нужно.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    const body: ApiErrorResponse = {
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    };
    res.status(err.status).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ApiErrorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Данные не прошли проверку',
        details: formatZodIssues(err),
      },
    };
    res.status(400).json(body);
    return;
  }

  // Всё, что сюда дошло, — незапланированный сбой. Наружу отдаём общее
  // сообщение, подробности оставляем в логах: текст ошибки может содержать
  // фрагменты запросов и строку подключения.
  console.error('Необработанная ошибка:', err);

  const body: ApiErrorResponse = {
    error: {
      code: 'INTERNAL_ERROR',
      message:
        env.NODE_ENV === 'production'
          ? 'Внутренняя ошибка сервера'
          : err instanceof Error
            ? err.message
            : String(err),
    },
  };
  res.status(500).json(body);
};
