import { z } from 'zod';

/**
 * Схемы живут в общем пакете, чтобы форма на фронте и валидация на бэке
 * проверяли ровно одно и то же — иначе они неизбежно разъедутся.
 */

export const registerSchema = z.object({
  email: z.email('Введите корректный email'),
  // Верхняя граница не косметическая: bcrypt учитывает только первые
  // 72 байта пароля, всё остальное молча отбрасывается.
  password: z
    .string()
    .min(8, 'Пароль должен быть не короче 8 символов')
    .max(72, 'Пароль должен быть не длиннее 72 символов'),
  /** IANA-таймзона, напр. "Europe/Moscow". По умолчанию берётся из браузера. */
  timezone: z.string().min(1).optional(),
});

export const loginSchema = z.object({
  email: z.email('Введите корректный email'),
  password: z.string().min(1, 'Введите пароль'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/** Публичное представление пользователя — без хеша пароля. */
export interface AuthUser {
  id: string;
  email: string;
  timezone: string;
}

export interface AuthResponse {
  user: AuthUser;
  /**
   * Access-токен живёт только в памяти фронта. Refresh-токен сюда не
   * попадает: он ездит в httpOnly-cookie и недоступен из JavaScript.
   */
  accessToken: string;
}
