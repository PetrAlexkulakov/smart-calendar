/**
 * Юнит-тесты раскрытия повторений. Базы здесь нет — функция чистая,
 * события собираются вручную.
 */
import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import type { EventWithExceptions } from './recurrence.ts';
import { expandEvents } from './recurrence.ts';

function makeEvent(overrides: Partial<EventWithExceptions> = {}): EventWithExceptions {
  const startsAt = new Date('2026-03-02T06:00:00.000Z');

  return {
    id: 'event-1',
    userId: 'user-1',
    title: 'Событие',
    description: null,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
    allDay: false,
    timezone: 'Europe/Moscow',
    rrule: null,
    recurrenceEndsAt: null,
    color: '#4f46e5',
    reminderMinutes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    exceptions: [],
    ...overrides,
  };
}

/** Локальное время вхождения в таймзоне события — то, что видит пользователь. */
function localTimes(occurrences: { startsAt: string }[], zone: string): string[] {
  return occurrences.map((occurrence) =>
    DateTime.fromISO(occurrence.startsAt, { zone }).toFormat('yyyy-MM-dd HH:mm'),
  );
}

describe('разовые события', () => {
  it('попадает в диапазон, который пересекает', () => {
    const event = makeEvent();

    const result = expandEvents(
      [event],
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-08T00:00:00Z'),
    );

    expect(result).toHaveLength(1);
    expect(result[0].isRecurring).toBe(false);
    expect(result[0].occurrenceStart).toBe('2026-03-02T06:00:00.000Z');
  });

  it('не попадает в диапазон, который не пересекает', () => {
    const result = expandEvents(
      [makeEvent()],
      new Date('2026-04-01T00:00:00Z'),
      new Date('2026-04-08T00:00:00Z'),
    );

    expect(result).toEqual([]);
  });

  it('видно, если началось до окна, но ещё идёт', () => {
    const event = makeEvent({
      startsAt: new Date('2026-03-01T20:00:00Z'),
      endsAt: new Date('2026-03-02T04:00:00Z'),
    });

    const result = expandEvents(
      [event],
      new Date('2026-03-02T00:00:00Z'),
      new Date('2026-03-03T00:00:00Z'),
    );

    expect(result).toHaveLength(1);
  });
});

describe('простые повторения', () => {
  it('ежедневное правило даёт по вхождению на каждый день окна', () => {
    const event = makeEvent({ rrule: 'FREQ=DAILY' });

    const result = expandEvents(
      [event],
      new Date('2026-03-02T00:00:00Z'),
      new Date('2026-03-09T00:00:00Z'),
    );

    expect(result).toHaveLength(7);
    expect(result[0].isRecurring).toBe(true);
  });

  it('правило по будням пропускает выходные', () => {
    // 2 марта 2026 — понедельник.
    const event = makeEvent({ rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' });

    const result = expandEvents(
      [event],
      new Date('2026-03-02T00:00:00Z'),
      new Date('2026-03-09T00:00:00Z'),
    );

    expect(result).toHaveLength(5);
    expect(localTimes(result, 'Europe/Moscow').map((value) => value.slice(0, 10))).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
    ]);
  });

  it('recurrenceEndsAt обрывает серию', () => {
    const event = makeEvent({
      rrule: 'FREQ=DAILY',
      recurrenceEndsAt: new Date('2026-03-04T23:59:00Z'),
    });

    const result = expandEvents(
      [event],
      new Date('2026-03-02T00:00:00Z'),
      new Date('2026-03-09T00:00:00Z'),
    );

    expect(result).toHaveLength(3);
  });

  it('вхождения отсортированы по времени начала', () => {
    const daily = makeEvent({ id: 'daily', rrule: 'FREQ=DAILY' });
    const single = makeEvent({
      id: 'single',
      startsAt: new Date('2026-03-04T03:00:00Z'),
      endsAt: new Date('2026-03-04T04:00:00Z'),
    });

    const result = expandEvents(
      [daily, single],
      new Date('2026-03-02T00:00:00Z'),
      new Date('2026-03-06T00:00:00Z'),
    );

    const timestamps = result.map((occurrence) => new Date(occurrence.startsAt).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });
});

describe('переход на летнее время', () => {
  it('сохраняет локальное время встречи, хотя UTC-смещение меняется', () => {
    // В Берлине летнее время начинается 29 марта 2026: до него UTC+1,
    // после — UTC+2. Встреча в 9:00 обязана остаться в 9:00.
    const zone = 'Europe/Berlin';
    const event = makeEvent({
      timezone: zone,
      startsAt: new Date('2026-03-27T08:00:00.000Z'), // 09:00 по Берлину
      endsAt: new Date('2026-03-27T09:00:00.000Z'),
      rrule: 'FREQ=DAILY',
    });

    const result = expandEvents(
      [event],
      new Date('2026-03-27T00:00:00Z'),
      new Date('2026-04-01T00:00:00Z'),
    );

    expect(localTimes(result, zone)).toEqual([
      '2026-03-27 09:00',
      '2026-03-28 09:00',
      '2026-03-29 09:00',
      '2026-03-30 09:00',
      '2026-03-31 09:00',
    ]);

    // А вот в UTC время действительно разъезжается — ради этого всё и затевалось.
    expect(result[0].startsAt).toBe('2026-03-27T08:00:00.000Z');
    expect(result[4].startsAt).toBe('2026-03-31T07:00:00.000Z');
  });

  it('событие на весь день не съезжает на сутки при переходе', () => {
    const zone = 'Europe/Berlin';
    const event = makeEvent({
      timezone: zone,
      allDay: true,
      startsAt: new Date('2026-03-27T23:00:00.000Z'), // 28 марта по Берлину
      endsAt: new Date('2026-03-28T23:00:00.000Z'),
      rrule: 'FREQ=DAILY',
    });

    const result = expandEvents(
      [event],
      new Date('2026-03-27T00:00:00Z'),
      new Date('2026-04-01T00:00:00Z'),
    );

    const days = result.map((occurrence) =>
      DateTime.fromISO(occurrence.startsAt, { zone }).toFormat('yyyy-MM-dd'),
    );
    // Первое апреля здесь не лишнее: по Берлину эти сутки начинаются
    // 31 марта в 22:00 UTC, то есть внутри окна, которое задано в UTC.
    expect(days).toEqual(['2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31', '2026-04-01']);

    // Каждое вхождение длится ровно сутки в локальном календаре,
    // даже те, в которых 23 часа реального времени.
    for (const occurrence of result) {
      const start = DateTime.fromISO(occurrence.startsAt, { zone });
      const end = DateTime.fromISO(occurrence.endsAt, { zone });
      expect(end.diff(start, 'days').days).toBe(1);
    }
  });
});

describe('отклонения серии', () => {
  const baseException = {
    id: 'exception-1',
    eventId: 'event-1',
    isCancelled: false,
    startsAt: null,
    endsAt: null,
    title: null,
    description: null,
    createdAt: new Date(),
  };

  it('отменённое вхождение исчезает, остальные остаются', () => {
    const event = makeEvent({
      rrule: 'FREQ=DAILY',
      exceptions: [
        {
          ...baseException,
          originalStart: new Date('2026-03-04T06:00:00.000Z'),
          isCancelled: true,
        },
      ],
    });

    const result = expandEvents(
      [event],
      new Date('2026-03-02T00:00:00Z'),
      new Date('2026-03-09T00:00:00Z'),
    );

    expect(result).toHaveLength(6);
    expect(result.map((occurrence) => occurrence.occurrenceStart)).not.toContain(
      '2026-03-04T06:00:00.000Z',
    );
  });

  it('перенесённое вхождение показывается на новом времени, но помнит исходное', () => {
    const event = makeEvent({
      rrule: 'FREQ=DAILY',
      exceptions: [
        {
          ...baseException,
          originalStart: new Date('2026-03-04T06:00:00.000Z'),
          startsAt: new Date('2026-03-04T15:00:00.000Z'),
          endsAt: new Date('2026-03-04T16:00:00.000Z'),
          title: 'Перенесённая встреча',
        },
      ],
    });

    const result = expandEvents(
      [event],
      new Date('2026-03-02T00:00:00Z'),
      new Date('2026-03-09T00:00:00Z'),
    );

    const moved = result.find(
      (occurrence) => occurrence.occurrenceStart === '2026-03-04T06:00:00.000Z',
    );

    expect(moved).toBeDefined();
    expect(moved!.startsAt).toBe('2026-03-04T15:00:00.000Z');
    expect(moved!.title).toBe('Перенесённая встреча');
    expect(moved!.isOverridden).toBe(true);
  });

  it('отмена разового события убирает его целиком', () => {
    const event = makeEvent({
      exceptions: [
        {
          ...baseException,
          originalStart: new Date('2026-03-02T06:00:00.000Z'),
          isCancelled: true,
        },
      ],
    });

    const result = expandEvents(
      [event],
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-08T00:00:00Z'),
    );

    expect(result).toEqual([]);
  });
});

describe('устойчивость', () => {
  it('битое правило не роняет календарь — событие показывается как разовое', () => {
    const event = makeEvent({ rrule: 'ЭТО НЕ ПРАВИЛО' });

    const result = expandEvents(
      [event],
      new Date('2026-03-01T00:00:00Z'),
      new Date('2026-03-08T00:00:00Z'),
    );

    expect(result).toHaveLength(1);
  });

  it('частое правило на широком окне не разворачивается безгранично', () => {
    const event = makeEvent({ rrule: 'FREQ=HOURLY' });

    const result = expandEvents(
      [event],
      new Date('2026-03-02T00:00:00Z'),
      new Date('2027-02-01T00:00:00Z'),
    );

    expect(result.length).toBeLessThanOrEqual(1000);
  });
});
