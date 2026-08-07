/**
 * Общие типы и схемы, которые используют и бэкенд, и фронтенд.
 *
 * Пакет намеренно экспортирует TypeScript-исходники (см. `exports` в package.json):
 * сборка не нужна, tsx и Vite резолвят их напрямую через симлинк npm workspaces.
 *
 * По мере роста проекта сюда переедут DTO событий, схемы валидации форм
 * и типы ответов API — чтобы фронт и бэк не расходились в определениях.
 */

export interface HealthResponse {
  status: 'ok';
  /** Время ответа сервера в ISO 8601, UTC. */
  timestamp: string;
  uptimeSeconds: number;
}

/** Единый формат ошибки, который отдаёт API (см. middleware/errorHandler). */
export interface ApiErrorResponse {
  error: {
    /** Машиночитаемый код, напр. 'VALIDATION_ERROR' или 'UNAUTHORIZED'. */
    code: string;
    message: string;
    /** Детали валидации: путь поля → сообщения. */
    details?: Record<string, string[]>;
  };
}
