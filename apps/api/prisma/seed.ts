/**
 * Тестовые данные для разработки: `npm run db:seed -w @smart-calendar/api`.
 *
 * Скрипт идемпотентен — сначала сносит прежних пользователей (остальное
 * уходит по каскаду), затем создаёт всё заново. Даты считаются от «сегодня»,
 * поэтому данные не протухают.
 *
 * Набор событий подобран так, чтобы покрыть все ветки будущего раскрытия
 * повторений: разовое, ежедневное, по будням, еженедельное с отменённым
 * и перенесённым вхождением, ежемесячное и событие на весь день.
 */
import bcrypt from 'bcrypt';
import { DateTime } from 'luxon';

import { disconnectPrisma, prisma } from '../src/lib/prisma.ts';

const PASSWORD = 'password123';

/** Момент времени в заданной таймзоне → Date в UTC. */
function at(base: DateTime, hour: number, minute = 0): Date {
  return base.set({ hour, minute, second: 0, millisecond: 0 }).toJSDate();
}

/** Ближайший будущий день недели (1 = понедельник … 7 = воскресенье). */
function nextWeekday(base: DateTime, weekday: number): DateTime {
  const diff = (weekday - base.weekday + 7) % 7 || 7;
  return base.plus({ days: diff });
}

async function main() {
  // Каскад в схеме снесёт события, токены и подписки вместе с пользователями.
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const alice = await prisma.user.create({
    data: { email: 'alice@example.com', passwordHash, timezone: 'Europe/Moscow' },
  });
  const bob = await prisma.user.create({
    data: { email: 'bob@example.com', passwordHash, timezone: 'Asia/Yekaterinburg' },
  });

  const msk = DateTime.now().setZone(alice.timezone).startOf('day');
  const ekb = DateTime.now().setZone(bob.timezone).startOf('day');

  // --- Разовое событие ---
  await prisma.event.create({
    data: {
      userId: alice.id,
      title: 'Стоматолог',
      description: 'Плановый осмотр',
      startsAt: at(msk.plus({ days: 1 }), 14),
      endsAt: at(msk.plus({ days: 1 }), 15),
      timezone: alice.timezone,
      color: '#0ea5e9',
      reminderMinutes: [60],
    },
  });

  // --- Ежедневное ---
  await prisma.event.create({
    data: {
      userId: alice.id,
      title: 'Утренняя зарядка',
      startsAt: at(msk, 7),
      endsAt: at(msk, 7, 30),
      timezone: alice.timezone,
      rrule: 'FREQ=DAILY',
      color: '#22c55e',
      reminderMinutes: [10],
    },
  });

  // --- По будням, серия ограничена по времени ---
  await prisma.event.create({
    data: {
      userId: alice.id,
      title: 'Дейли-митинг',
      description: 'Синк команды',
      startsAt: at(nextWeekday(msk, 1), 10),
      endsAt: at(nextWeekday(msk, 1), 10, 15),
      timezone: alice.timezone,
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      recurrenceEndsAt: msk.plus({ months: 3 }).toJSDate(),
      color: '#f97316',
      reminderMinutes: [5],
    },
  });

  // --- Еженедельное с отклонениями в серии ---
  const englishStart = nextWeekday(msk, 2); // вторник
  const english = await prisma.event.create({
    data: {
      userId: alice.id,
      title: 'Английский',
      startsAt: at(englishStart, 19),
      endsAt: at(englishStart, 20),
      timezone: alice.timezone,
      rrule: 'FREQ=WEEKLY;BYDAY=TU',
      color: '#a855f7',
      reminderMinutes: [30],
    },
  });

  await prisma.eventException.createMany({
    data: [
      {
        // Занятие через неделю отменено — преподаватель в отпуске.
        eventId: english.id,
        originalStart: at(englishStart.plus({ weeks: 1 }), 19),
        isCancelled: true,
      },
      {
        // Занятие через две недели перенесено на час позже.
        eventId: english.id,
        originalStart: at(englishStart.plus({ weeks: 2 }), 19),
        startsAt: at(englishStart.plus({ weeks: 2 }), 20),
        endsAt: at(englishStart.plus({ weeks: 2 }), 21),
        title: 'Английский (перенос)',
      },
    ],
  });

  // --- Ежемесячное ---
  await prisma.event.create({
    data: {
      userId: alice.id,
      title: 'Оплатить интернет',
      startsAt: at(msk.set({ day: 5 }).plus({ months: 1 }), 12),
      endsAt: at(msk.set({ day: 5 }).plus({ months: 1 }), 12, 15),
      timezone: alice.timezone,
      rrule: 'FREQ=MONTHLY;BYMONTHDAY=5',
      color: '#64748b',
      reminderMinutes: [1440],
    },
  });

  // --- На весь день, ежегодное ---
  await prisma.event.create({
    data: {
      userId: alice.id,
      title: 'День рождения Кати',
      startsAt: msk.plus({ days: 10 }).toJSDate(),
      endsAt: msk.plus({ days: 11 }).toJSDate(),
      allDay: true,
      timezone: alice.timezone,
      rrule: 'FREQ=YEARLY',
      color: '#ec4899',
      reminderMinutes: [1440],
    },
  });

  // --- События второго пользователя: проверяют изоляцию по userId ---
  await prisma.event.create({
    data: {
      userId: bob.id,
      title: 'Созвон с подрядчиком',
      startsAt: at(ekb.plus({ days: 2 }), 16),
      endsAt: at(ekb.plus({ days: 2 }), 17),
      timezone: bob.timezone,
      reminderMinutes: [15],
    },
  });

  await prisma.event.create({
    data: {
      userId: bob.id,
      title: 'Бассейн',
      startsAt: at(nextWeekday(ekb, 4), 20),
      endsAt: at(nextWeekday(ekb, 4), 21),
      timezone: bob.timezone,
      rrule: 'FREQ=WEEKLY;BYDAY=TH',
      color: '#06b6d4',
    },
  });

  const [users, events, exceptions] = await Promise.all([
    prisma.user.count(),
    prisma.event.count(),
    prisma.eventException.count(),
  ]);

  console.log(`Готово: ${users} пользователя, ${events} событий, ${exceptions} исключения.`);
  console.log(`Вход: alice@example.com / bob@example.com, пароль — ${PASSWORD}`);
}

try {
  await main();
} finally {
  await disconnectPrisma();
}
