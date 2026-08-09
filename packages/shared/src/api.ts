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
