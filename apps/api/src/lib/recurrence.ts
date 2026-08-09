import type { EventOccurrence } from '@smart-calendar/shared';
import { DateTime } from 'luxon';
// Именованный импорт здесь не работает: Node резолвит rrule в CJS-сборку,
// где всё лежит под default. В Vite, наоборот, подхватывается ESM-сборка
// с именованными экспортами — поэтому пакет и не вынесен в shared.
import rrulePackage from 'rrule';

import type { Event, EventException } from '../../generated/prisma/client.ts';

const { RRule } = rrulePackage;

export type EventWithExceptions = Event & { exceptions: EventException[] };

/**
 * Потолок на одно событие. Правило вроде FREQ=HOURLY на годовом диапазоне
 * даст почти девять тысяч вхождений — отдавать такое в браузер бессмысленно.
 */
const MAX_OCCURRENCES_PER_EVENT = 1000;

/**
 * Библиотека rrule умеет считать только в «плавающем» времени: она берёт
 * компоненты даты (год, месяц, день, час) и не знает о таймзонах. Поэтому
 * повторения раскрываются в три шага:
 *
 *   1. настоящий UTC → компоненты в таймзоне события (toFloating);
 *   2. rrule работает с этими компонентами, не подозревая о переходах;
 *   3. компоненты → настоящий UTC обратно в таймзоне события (fromFloating).
 *
 * Именно поэтому «каждый день в 9:00 по Москве» остаётся в 9:00 и после
 * перехода на летнее время, хотя UTC-смещение при этом меняется.
 */
function toFloating(date: Date, zone: string): Date {
  const local = DateTime.fromJSDate(date, { zone });
  return new Date(
    Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
      local.millisecond,
    ),
  );
}

function fromFloating(floating: Date, zone: string): Date {
  return DateTime.fromObject(
    {
      year: floating.getUTCFullYear(),
      month: floating.getUTCMonth() + 1,
      day: floating.getUTCDate(),
      hour: floating.getUTCHours(),
      minute: floating.getUTCMinutes(),
      second: floating.getUTCSeconds(),
      millisecond: floating.getUTCMilliseconds(),
    },
    { zone },
  )
    .toUTC()
    .toJSDate();
}

/** Проверяет, что строка — разбираемое правило RFC 5545. */
export function isValidRRule(rule: string): boolean {
  try {
    RRule.parseString(rule);
    return true;
  } catch {
    return false;
  }
}

/**
 * Конец вхождения. Для события «на весь день» длительность считается
 * в календарных днях, иначе — в миллисекундах: сутки во время перехода
 * на летнее время длятся 23 часа, и прибавление 24 часов сдвинуло бы дату.
 */
function occurrenceEnd(start: Date, event: EventWithExceptions): Date {
  if (event.allDay) {
    const days = Math.max(
      1,
      Math.round((event.endsAt.getTime() - event.startsAt.getTime()) / (24 * 60 * 60 * 1000)),
    );
    return DateTime.fromJSDate(start, { zone: event.timezone }).plus({ days }).toUTC().toJSDate();
  }

  return new Date(start.getTime() + (event.endsAt.getTime() - event.startsAt.getTime()));
}

function buildOccurrence(
  event: EventWithExceptions,
  occurrenceStart: Date,
  override: EventException | undefined,
): EventOccurrence {
  const startsAt = override?.startsAt ?? occurrenceStart;
  const endsAt = override?.endsAt ?? occurrenceEnd(startsAt, event);

  return {
    eventId: event.id,
    occurrenceStart: occurrenceStart.toISOString(),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    title: override?.title ?? event.title,
    description: override?.description ?? event.description,
    allDay: event.allDay,
    color: event.color,
    timezone: event.timezone,
    reminderMinutes: event.reminderMinutes,
    isOverridden: override !== undefined,
    isRecurring: event.rrule !== null,
  };
}

/** Пересекается ли отрезок события с запрошенным окном. */
function overlapsRange(startsAt: Date, endsAt: Date, from: Date, to: Date): boolean {
  return startsAt.getTime() < to.getTime() && endsAt.getTime() > from.getTime();
}

/**
 * Раскрывает события в конкретные вхождения, попадающие в [from, to).
 *
 * Отклонения серии применяются по ключу originalStart: отменённые
 * вхождения выпадают, перенесённые подставляются на новое время
 * (и могут при этом уехать за пределы окна — такие тоже отсеиваются).
 */
export function expandEvents(
  events: EventWithExceptions[],
  from: Date,
  to: Date,
): EventOccurrence[] {
  const occurrences: EventOccurrence[] = [];

  for (const event of events) {
    const exceptionsByStart = new Map(
      event.exceptions.map((exception) => [exception.originalStart.getTime(), exception]),
    );

    if (!event.rrule) {
      const override = exceptionsByStart.get(event.startsAt.getTime());
      if (override?.isCancelled) continue;

      const occurrence = buildOccurrence(event, event.startsAt, override);
      if (overlapsRange(new Date(occurrence.startsAt), new Date(occurrence.endsAt), from, to)) {
        occurrences.push(occurrence);
      }
      continue;
    }

    let options;
    try {
      options = RRule.parseString(event.rrule);
    } catch {
      // Битое правило не должно ронять весь календарь: показываем
      // такое событие как разовое.
      const occurrence = buildOccurrence(event, event.startsAt, undefined);
      if (overlapsRange(new Date(occurrence.startsAt), new Date(occurrence.endsAt), from, to)) {
        occurrences.push(occurrence);
      }
      continue;
    }

    const zone = event.timezone;
    const durationMs = event.endsAt.getTime() - event.startsAt.getTime();

    // Нижнюю границу поиска сдвигаем на длительность события назад:
    // вхождение могло начаться до окна и всё ещё идти.
    const searchFrom = new Date(from.getTime() - durationMs);
    const searchTo =
      event.recurrenceEndsAt && event.recurrenceEndsAt.getTime() < to.getTime()
        ? event.recurrenceEndsAt
        : to;

    if (searchTo.getTime() <= searchFrom.getTime()) continue;

    const rule = new RRule({
      ...options,
      dtstart: toFloating(event.startsAt, zone),
      ...(event.recurrenceEndsAt && { until: toFloating(event.recurrenceEndsAt, zone) }),
    });

    const floatingDates = rule.between(
      toFloating(searchFrom, zone),
      toFloating(searchTo, zone),
      true,
    );

    for (const floating of floatingDates.slice(0, MAX_OCCURRENCES_PER_EVENT)) {
      const occurrenceStart = fromFloating(floating, zone);
      const override = exceptionsByStart.get(occurrenceStart.getTime());

      if (override?.isCancelled) continue;

      const occurrence = buildOccurrence(event, occurrenceStart, override);
      if (overlapsRange(new Date(occurrence.startsAt), new Date(occurrence.endsAt), from, to)) {
        occurrences.push(occurrence);
      }
    }
  }

  return occurrences.sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
}
