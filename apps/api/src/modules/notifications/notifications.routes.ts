import { pushSubscriptionSchema, unsubscribeSchema } from '@smart-calendar/shared';
import { Router } from 'express';

import { env } from '../../config/env.ts';
import { prisma } from '../../lib/prisma.ts';
import { getUserId, requireAuth } from '../../middleware/requireAuth.ts';
import { validateBody } from '../../middleware/validate.ts';
import { isPushConfigured } from './push.ts';

export const notificationsRouter = Router();

/**
 * Публичный ключ VAPID нужен браузеру при подписке. Он не секретный —
 * секретна только приватная половина пары.
 */
notificationsRouter.get('/vapid-public-key', (_req, res) => {
  res.json({
    publicKey: env.VAPID_PUBLIC_KEY ?? null,
    enabled: isPushConfigured,
  });
});

notificationsRouter.use(requireAuth);

/**
 * Сохраняет подписку браузера. Одна строка на устройство: endpoint
 * уникален, поэтому повторная подписка обновляет существующую запись,
 * а не плодит дубли.
 */
notificationsRouter.post('/subscribe', validateBody(pushSubscriptionSchema), async (req, res) => {
  const userId = getUserId(req);
  const { endpoint, keys } = req.body;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.get('user-agent') ?? null,
    },
    // Тот же браузер мог раньше принадлежать другому аккаунту —
    // подписку надо переприсвоить, иначе уведомления уйдут не туда.
    update: {
      userId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent: req.get('user-agent') ?? null,
    },
  });

  res.status(204).end();
});

notificationsRouter.post('/unsubscribe', validateBody(unsubscribeSchema), async (req, res) => {
  // Удаляем только свою подписку: чужой endpoint отписать нельзя.
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: req.body.endpoint, userId: getUserId(req) },
  });

  res.status(204).end();
});

/** Сколько устройств подписано — фронту нужно, чтобы показать состояние. */
notificationsRouter.get('/subscriptions', async (req, res) => {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: getUserId(req) },
    select: { id: true, endpoint: true, userAgent: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ subscriptions });
});
