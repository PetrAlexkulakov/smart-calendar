/**
 * Тесты планировщика напоминаний.
 *
 * Push реально никуда не уходит — подписок у тестовых пользователей нет.
 * Проверяется решение «пора отправлять или нет» и защита от повторов:
 * именно она страдает при перезапуске сервера.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { disconnectPrisma, prisma } from '../../lib/prisma.ts';
import { cleanupSentLog, runReminderTick } from './scheduler.ts';

const testStartedAt = new Date();
const createdEmails: string[] = [];

async function createUserWithEvent(options: {
  minutesFromNow: number;
  reminderMinutes: number[];
  rrule?: string;
}) {
  const email = `scheduler-test-${randomUUID()}@example.com`;
  createdEmails.push(email);

  const user = await prisma.user.create({
    data: { email, passwordHash: 'not-used-in-this-test', timezone: 'Europe/Moscow' },
  });

  const startsAt = new Date(Date.now() + options.minutesFromNow * 60 * 1000);
  const event = await prisma.event.create({
    data: {
      userId: user.id,
      title: 'Событие с напоминанием',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60 * 1000),
      timezone: 'Europe/Moscow',
      reminderMinutes: options.reminderMinutes,
      ...(options.rrule && { rrule: options.rrule }),
    },
  });

  return { user, event };
}

/** Сколько напоминаний записано в журнал для конкретного события. */
function countSent(eventId: string) {
  return prisma.sentNotification.count({ where: { eventId } });
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  // Убираем журнальные записи, которые тик мог создать по чужим событиям.
  await prisma.sentNotification.deleteMany({ where: { sentAt: { gte: testStartedAt } } });
  await disconnectPrisma();
});

describe('runReminderTick', () => {
  it('отправляет напоминание, когда его время наступило', async () => {
    // Событие через 9 минут, напомнить за 10 — момент отправки уже прошёл,
    // но ещё не протух.
    const { event } = await createUserWithEvent({ minutesFromNow: 9, reminderMinutes: [10] });

    await runReminderTick();

    expect(await countSent(event.id)).toBe(1);
  });

  it('не отправляет напоминание, время которого ещё не пришло', async () => {
    // Событие через час, напомнить за 10 минут — рано.
    const { event } = await createUserWithEvent({ minutesFromNow: 60, reminderMinutes: [10] });

    await runReminderTick();

    expect(await countSent(event.id)).toBe(0);
  });

  it('не отправляет напоминание, которое давно протухло', async () => {
    // Событие началось 40 минут назад: напоминание за 10 минут должно было
    // уйти полчаса назад — рассылать его сейчас бессмысленно.
    const { event } = await createUserWithEvent({ minutesFromNow: -40, reminderMinutes: [10] });

    await runReminderTick();

    expect(await countSent(event.id)).toBe(0);
  });

  it('не отправляет одно и то же напоминание дважды', async () => {
    const { event } = await createUserWithEvent({ minutesFromNow: 9, reminderMinutes: [10] });

    await runReminderTick();
    await runReminderTick();
    await runReminderTick();

    // Именно это защищает от повторной рассылки после перезапуска сервера.
    expect(await countSent(event.id)).toBe(1);
  });

  it('обрабатывает несколько напоминаний одного события независимо', async () => {
    // Напомнить за 10 и за 60 минут; событие через 9 минут.
    // Первое сработать должно, второе давно протухло.
    const { event } = await createUserWithEvent({ minutesFromNow: 9, reminderMinutes: [10, 60] });

    await runReminderTick();

    const sent = await prisma.sentNotification.findMany({ where: { eventId: event.id } });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.reminderMinutes).toBe(10);
  });

  it('шлёт напоминание для ближайшего вхождения повторяющегося события', async () => {
    const { event } = await createUserWithEvent({
      minutesFromNow: 9,
      reminderMinutes: [10],
      rrule: 'FREQ=DAILY',
    });

    await runReminderTick();

    const sent = await prisma.sentNotification.findMany({ where: { eventId: event.id } });
    // Ровно одно: остальные вхождения серии ещё далеко впереди.
    expect(sent).toHaveLength(1);
  });

  it('игнорирует события без напоминаний', async () => {
    const { event } = await createUserWithEvent({ minutesFromNow: 9, reminderMinutes: [] });

    await runReminderTick();

    expect(await countSent(event.id)).toBe(0);
  });
});

describe('cleanupSentLog', () => {
  it('удаляет только записи старше недели', async () => {
    const { event } = await createUserWithEvent({ minutesFromNow: 9, reminderMinutes: [10] });

    const old = await prisma.sentNotification.create({
      data: {
        eventId: event.id,
        occurrenceStart: new Date('2020-01-01T00:00:00Z'),
        reminderMinutes: 10,
        sentAt: new Date('2020-01-01T00:00:00Z'),
      },
    });
    await runReminderTick();

    await cleanupSentLog();

    expect(await prisma.sentNotification.findUnique({ where: { id: old.id } })).toBeNull();
    // Свежая запись на месте.
    expect(await countSent(event.id)).toBe(1);
  });
});
