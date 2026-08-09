import { RRule } from 'rrule';
import { z } from 'zod';

/**
 * Правило должно разбираться и не быть безумно частым: FREQ=SECONDLY
 * на годовом окне — это тридцать миллионов вхождений.
 */
const rruleSchema = z
  .string()
  .max(500)
  .refine((value) => {
    try {
      RRule.parseString(value);
      return true;
    } catch {
      return false;
    }
  }, 'Не удалось разобрать правило повторения')
  .refine(
    (value) => !/FREQ=(SECONDLY|MINUTELY)/i.test(value),
    'Слишком частое повторение: минимальный шаг — час',
  );

/** Проверяет, что строка — существующая IANA-таймзона, а не произвольный текст. */
function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z
  .string()
  .min(1)
  .refine(isValidTimezone, 'Неизвестная таймзона, ожидается формат вида Europe/Moscow');

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Цвет задаётся в формате #rrggbb');

/**
 * За сколько минут до начала напомнить. Верхняя граница — неделя:
 * всё, что дальше, скорее опечатка, чем осознанное намерение.
 */
const reminderMinutesSchema = z
  .array(
    z
      .int()
      .min(0)
      .max(7 * 24 * 60),
  )
  .max(5, 'Не больше пяти напоминаний на событие')
  .refine((values) => new Set(values).size === values.length, 'Напоминания не должны повторяться');

/**
 * Поля события без значений по умолчанию.
 *
 * Умолчания живут только в схеме создания — и вот почему. `.partial()`
 * делает поле необязательным, но `.default()` при этом продолжает
 * срабатывать на undefined. Если бы умолчания стояли здесь, PATCH с одним
 * лишь названием молча сбрасывал бы цвет, признак «весь день»
 * и все напоминания.
 */
const eventFieldsSchema = z.object({
  title: z.string().trim().min(1, 'Введите название').max(200),
  description: z.string().max(2000).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  allDay: z.boolean(),
  timezone: timezoneSchema,
  /** Правило RFC 5545 без префикса, напр. "FREQ=WEEKLY;BYDAY=MO,WE". */
  rrule: rruleSchema.nullish(),
  recurrenceEndsAt: z.coerce.date().nullish(),
  color: colorSchema,
  reminderMinutes: reminderMinutesSchema,
});

/** Событие не может заканчиваться раньше, чем начинается. */
const hasValidRange = (data: { startsAt: Date; endsAt: Date }) =>
  data.endsAt.getTime() > data.startsAt.getTime();

export const createEventSchema = eventFieldsSchema
  .extend({
    allDay: z.boolean().default(false),
    color: colorSchema.default('#4f46e5'),
    reminderMinutes: reminderMinutesSchema.default([]),
  })
  .refine(hasValidRange, {
    message: 'Событие должно заканчиваться позже, чем начинается',
    path: ['endsAt'],
  });

/**
 * Обновление частичное, поэтому проверить порядок дат можно только когда
 * пришли оба поля; случай «прислали одну дату» досматривается на сервере,
 * где известны текущие значения.
 */
export const updateEventSchema = eventFieldsSchema
  .partial()
  .refine(
    (data) =>
      data.startsAt === undefined ||
      data.endsAt === undefined ||
      hasValidRange(data as { startsAt: Date; endsAt: Date }),
    { message: 'Событие должно заканчиваться позже, чем начинается', path: ['endsAt'] },
  );

/** Запрос календаря: какие события показать в видимом диапазоне. */
export const eventRangeQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((data) => data.to.getTime() > data.from.getTime(), {
    message: 'Конец диапазона должен быть позже начала',
    path: ['to'],
  })
  .refine(
    // Ограничение защищает от запроса «покажи 50 лет ежедневного события»,
    // который развернулся бы в десятки тысяч вхождений.
    (data) => data.to.getTime() - data.from.getTime() <= 366 * 24 * 60 * 60 * 1000,
    { message: 'Диапазон не может быть больше года', path: ['to'] },
  );

/**
 * Операции над одним вхождением серии. Ключ — occurrenceStart, то есть
 * время, которое дало правило (а не то, куда вхождение потом перенесли).
 */
export const cancelOccurrenceSchema = z.object({
  occurrenceStart: z.coerce.date(),
});

export const overrideOccurrenceSchema = z
  .object({
    occurrenceStart: z.coerce.date(),
    startsAt: z.coerce.date().optional(),
    endsAt: z.coerce.date().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).nullish(),
  })
  .refine(
    (data) =>
      data.startsAt === undefined ||
      data.endsAt === undefined ||
      data.endsAt.getTime() > data.startsAt.getTime(),
    { message: 'Событие должно заканчиваться позже, чем начинается', path: ['endsAt'] },
  )
  .refine(
    // Перенос задаётся парой дат: сдвинуть только начало нельзя,
    // иначе длительность вхождения станет неопределённой.
    (data) => (data.startsAt === undefined) === (data.endsAt === undefined),
    { message: 'Начало и конец переноса указываются вместе', path: ['endsAt'] },
  );

export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type EventRangeQuery = z.infer<typeof eventRangeQuerySchema>;
export type CancelOccurrenceInput = z.infer<typeof cancelOccurrenceSchema>;
export type OverrideOccurrenceInput = z.infer<typeof overrideOccurrenceSchema>;

/** Событие, как его отдаёт API: даты — строки ISO 8601 в UTC. */
export interface EventDto {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string;
  rrule: string | null;
  recurrenceEndsAt: string | null;
  color: string;
  reminderMinutes: number[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Одно вхождение события в календаре. Для разового события совпадает
 * с самим событием, для повторяющегося — конкретная дата серии.
 */
export interface EventOccurrence {
  /** id исходного события: у всех вхождений серии он общий. */
  eventId: string;
  /** Время, которое дало правило повторения. Ключ вхождения при переносе. */
  occurrenceStart: string;
  startsAt: string;
  endsAt: string;
  title: string;
  description: string | null;
  allDay: boolean;
  color: string;
  timezone: string;
  reminderMinutes: number[];
  /** true, если вхождение отличается от правила — перенесено или переименовано. */
  isOverridden: boolean;
  /** true для повторяющегося события. */
  isRecurring: boolean;
}
