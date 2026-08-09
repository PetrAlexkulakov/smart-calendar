import { z } from 'zod';

/**
 * То, что отдаёт браузерный PushManager.subscribe(). Форма фиксирована
 * стандартом Web Push, поэтому схема повторяет её один в один.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z.url('Некорректный endpoint подписки'),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

export const unsubscribeSchema = z.object({
  endpoint: z.url(),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** Тело push-сообщения: его разбирает Service Worker в обработчике 'push'. */
export interface PushPayload {
  title: string;
  body: string;
  /** Куда перейти по клику на уведомление. */
  url: string;
  /** Ключ схлопывания: повторное уведомление заменит предыдущее, а не добавится. */
  tag: string;
}
