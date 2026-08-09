import type { HealthResponse } from '@smart-calendar/shared';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { env } from './config/env.ts';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.ts';
import { authRouter } from './modules/auth/auth.routes.ts';
import { eventsRouter } from './modules/events/events.routes.ts';
import { notificationsRouter } from './modules/notifications/notifications.routes.ts';

/**
 * Сборка Express-приложения вынесена из index.ts, чтобы интеграционные тесты
 * могли поднять приложение через supertest, не занимая реальный порт.
 */
export function createApp() {
  const app = express();

  // credentials: true обязателен — refresh-токен ездит в httpOnly cookie,
  // а браузер не отправит её на другой origin без явного разрешения.
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    const body: HealthResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
    res.json(body);
  });

  app.use('/auth', authRouter);
  app.use('/events', eventsRouter);
  app.use('/notifications', notificationsRouter);

  // Порядок важен: сначала «маршрут не найден», затем обработчик ошибок —
  // оба должны стоять после всех остальных middleware.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
