import type { PushPayload } from '@smart-calendar/shared';
import webpush from 'web-push';

import type { PushSubscription } from '../../../generated/prisma/client.ts';
import { env } from '../../config/env.ts';
import { prisma } from '../../lib/prisma.ts';

/**
 * Push работает только при настроенных ключах VAPID — ими сервер
 * подписывает сообщения, доказывая push-сервису браузера, что отправитель
 * тот же, на кого подписывались.
 */
export const isPushConfigured = Boolean(
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT,
);

if (isPushConfigured) {
  webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
}

/**
 * Коды, означающие, что подписка мертва: пользователь отозвал разрешение
 * или удалил данные сайта. Такие строки нужно убирать из базы, иначе
 * планировщик будет долбиться в них вечно.
 */
const GONE_STATUS_CODES = new Set([404, 410]);

/**
 * Отправляет уведомление на одну подписку.
 * Возвращает false, если подписка мертва и была удалена.
 */
export async function sendToSubscription(
  subscription: PushSubscription,
  payload: PushPayload,
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return true;
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode;

    if (statusCode !== undefined && GONE_STATUS_CODES.has(statusCode)) {
      await prisma.pushSubscription.deleteMany({ where: { id: subscription.id } });
      return false;
    }

    // Прочие сбои (таймаут, 500 у push-сервиса) — не повод удалять подписку:
    // пробуем снова на следующем тике.
    console.error(`Не удалось отправить push на ${subscription.endpoint}:`, error);
    return false;
  }
}

/** Рассылает уведомление на все устройства пользователя. */
export async function sendToUser(userId: string, payload: PushPayload): Promise<number> {
  const subscriptions = await prisma.pushSubscription.findMany({ where: { userId } });

  const results = await Promise.all(
    subscriptions.map((subscription) => sendToSubscription(subscription, payload)),
  );

  return results.filter(Boolean).length;
}
