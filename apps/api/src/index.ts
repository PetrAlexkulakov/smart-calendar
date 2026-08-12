import { createApp } from './app.ts';
import { env } from './config/env.ts';
import { disconnectPrisma } from './lib/prisma.ts';
import { startScheduler } from './modules/notifications/scheduler.ts';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`API слушает http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

startScheduler();

/**
 * Корректное завершение: перестаём принимать новые запросы, даём текущим
 * доиграть и только потом закрываем пул соединений с базой.
 */
function shutdown(signal: string): void {
  console.log(`Получен ${signal}, останавливаем сервер…`);

  server.close(() => {
    void disconnectPrisma().then(() => process.exit(0));
  });

  // Если соединения висят дольше десяти секунд — выходим принудительно.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
