import type { PushPayload } from '@smart-calendar/shared';
import { DateTime } from 'luxon';
import cron from 'node-cron';

import { env } from '../../config/env.ts';
import { prisma } from '../../lib/prisma.ts';
import { expandEvents } from '../../lib/recurrence.ts';
import { isPushConfigured, sendToUser } from './push.ts';

const MINUTE_MS = 60 * 1000;

/** Верхняя граница напоминания по схеме события — неделя. */
const MAX_REMINDER_MS = 7 * 24 * 60 * MINUTE_MS;

/**
 * Насколько запоздавшее напоминание всё ещё имеет смысл отправить.
 * Тик может пропуститься из-за перезапуска или зависшего запроса; пять
 * минут форы это переживают, а протухшие напоминания не рассылаются.
 */
const GRACE_MS = 5 * MINUTE_MS;

/** Журнал отправок нужен только для защиты от дублей, вечно хранить его незачем. */
const SENT_LOG_TTL_DAYS = 7;

function buildPayload(
  occurrence: { title: string; startsAt: string; timezone: string; eventId: string },
  reminderMinutes: number,
): PushPayload {
  const localTime = DateTime.fromISO(occurrence.startsAt, {
    zone: occurrence.timezone,
  }).toFormat('HH:mm');

  const when =
    reminderMinutes === 0
      ? 'Начинается сейчас'
      : reminderMinutes < 60
        ? `Через ${reminderMinutes} мин`
        : reminderMinutes % (24 * 60) === 0
          ? `Через ${reminderMinutes / (24 * 60)} дн`
          : `Через ${Math.round(reminderMinutes / 60)} ч`;

  return {
    title: occurrence.title,
    body: `${when}, в ${localTime}`,
    url: '/',
    // Тег привязан к вхождению и напоминанию: повторный показ заменит
    // предыдущее уведомление, а не насыпет их стопкой.
    tag: `${occurrence.eventId}:${occurrence.startsAt}:${reminderMinutes}`,
  };
}

/**
 * Один проход планировщика: находит напоминания, время которых наступило,
 * и рассылает их.
 *
 * Вынесен в экспортируемую функцию, чтобы его можно было прогнать вручную,
 * не дожидаясь наступления реального времени.
 */
export async function runReminderTick(now: Date = new Date()): Promise<number> {
  const from = new Date(now.getTime() - GRACE_MS);
  const to = new Date(now.getTime() + MAX_REMINDER_MS);

  // Берём только события, у которых вообще есть напоминания.
  const events = await prisma.event.findMany({
    where: {
      reminderMinutes: { isEmpty: false },
      startsAt: { lt: to },
      OR: [
        { rrule: null, endsAt: { gt: from } },
        {
          rrule: { not: null },
          OR: [{ recurrenceEndsAt: null }, { recurrenceEndsAt: { gt: from } }],
        },
      ],
    },
    include: { exceptions: true },
  });

  if (events.length === 0) return 0;

  const userIdByEvent = new Map(events.map((event) => [event.id, event.userId]));
  const occurrences = expandEvents(events, from, to);

  let sentCount = 0;

  for (const occurrence of occurrences) {
    const userId = userIdByEvent.get(occurrence.eventId);
    if (!userId) continue;

    const startsAt = new Date(occurrence.startsAt);

    for (const reminderMinutes of occurrence.reminderMinutes) {
      const sendAt = startsAt.getTime() - reminderMinutes * MINUTE_MS;

      // Момент отправки уже наступил, но ещё не протух.
      if (sendAt > now.getTime() || sendAt <= from.getTime()) continue;

      // Запись в журнал делается ДО отправки: уникальный индекс не даст
      // двум тикам (или двум инстансам сервера) отправить одно и то же.
      try {
        await prisma.sentNotification.create({
          data: {
            eventId: occurrence.eventId,
            occurrenceStart: new Date(occurrence.occurrenceStart),
            reminderMinutes,
          },
        });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2002') continue;
        throw error;
      }

      sentCount += await sendToUser(userId, buildPayload(occurrence, reminderMinutes));
    }
  }

  return sentCount;
}

/** Убирает старые записи журнала отправок. */
export async function cleanupSentLog(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.sentNotification.deleteMany({
    where: { sentAt: { lt: new Date(now.getTime() - SENT_LOG_TTL_DAYS * 24 * 60 * MINUTE_MS) } },
  });

  return count;
}

let tickRunning = false;

/** Запускает периодические задачи. Вызывается один раз при старте сервера. */
export function startScheduler(): void {
  if (!isPushConfigured) {
    console.warn(
      'Планировщик напоминаний не запущен: не заданы ключи VAPID. ' +
        'Сгенерировать: npx web-push generate-vapid-keys',
    );
    return;
  }

  cron.schedule('* * * * *', async () => {
    // Если предыдущий проход ещё идёт (например, база тормозит),
    // второй запускать нельзя — пойдут параллельные отправки.
    if (tickRunning) return;
    tickRunning = true;

    try {
      const sent = await runReminderTick();
      if (sent > 0) {
        console.log(`Отправлено напоминаний: ${sent}`);
      }
    } catch (error) {
      console.error('Сбой в тике планировщика:', error);
    } finally {
      tickRunning = false;
    }
  });

  cron.schedule('0 4 * * *', async () => {
    try {
      await cleanupSentLog();
    } catch (error) {
      console.error('Не удалось почистить журнал отправок:', error);
    }
  });

  console.log(`Планировщик напоминаний запущен (${env.NODE_ENV})`);
}
