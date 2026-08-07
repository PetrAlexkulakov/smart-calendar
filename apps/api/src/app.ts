import type { HealthResponse } from '@smart-calendar/shared';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { env } from './config/env.ts';

/**
 * Сборка Express-приложения вынесена из index.ts, чтобы интеграционные тесты
 * могли поднять приложение через supertest, не занимая реальный порт.
 */
export function createApp() {
  const app = express();

  // credentials: true обязателен — refresh-токен будет ездить в httpOnly cookie,
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

  // Здесь будут подключаться роутеры: /auth (этап 2), /events (этап 3),
  // /notifications (этап 6).

  return app;
}
