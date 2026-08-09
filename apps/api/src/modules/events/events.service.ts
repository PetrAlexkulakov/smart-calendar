import type {
  CreateEventInput,
  EventDto,
  EventOccurrence,
  OverrideOccurrenceInput,
  UpdateEventInput,
} from '@smart-calendar/shared';

import { NotFoundError, ValidationError } from '../../lib/errors.ts';
import { prisma } from '../../lib/prisma.ts';
import { expandEvents } from '../../lib/recurrence.ts';
import type { Event } from '../../../generated/prisma/client.ts';

export function toEventDto(event: Event): EventDto {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    allDay: event.allDay,
    timezone: event.timezone,
    rrule: event.rrule,
    recurrenceEndsAt: event.recurrenceEndsAt?.toISOString() ?? null,
    color: event.color,
    reminderMinutes: event.reminderMinutes,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

/**
 * События пользователя, которые могут попасть в диапазон [from, to).
 *
 * Разовое событие попадает, если пересекается с диапазоном. Повторяющееся
 * берём, если серия началась до конца диапазона и ещё не закончилась к его
 * началу — какие именно даты серии видны, решает уже раскрытие правила.
 */
export async function listEventsInRange(userId: string, from: Date, to: Date) {
  return prisma.event.findMany({
    where: {
      userId,
      OR: [
        { rrule: null, startsAt: { lt: to }, endsAt: { gt: from } },
        {
          rrule: { not: null },
          startsAt: { lt: to },
          OR: [{ recurrenceEndsAt: null }, { recurrenceEndsAt: { gt: from } }],
        },
      ],
    },
    include: { exceptions: true },
    orderBy: { startsAt: 'asc' },
  });
}

/** Читает событие, убеждаясь, что оно принадлежит пользователю. */
export async function getEventOwned(userId: string, eventId: string): Promise<Event> {
  const event = await prisma.event.findFirst({ where: { id: eventId, userId } });

  // Чужое событие даёт ту же 404, что и несуществующее: иначе по коду
  // ответа можно было бы проверять, какие id существуют.
  if (!event) {
    throw new NotFoundError('Событие не найдено');
  }
  return event;
}

export async function createEvent(userId: string, input: CreateEventInput): Promise<EventDto> {
  const event = await prisma.event.create({
    data: {
      userId,
      title: input.title,
      description: input.description ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      allDay: input.allDay,
      timezone: input.timezone,
      rrule: input.rrule ?? null,
      recurrenceEndsAt: input.recurrenceEndsAt ?? null,
      color: input.color,
      reminderMinutes: input.reminderMinutes,
    },
  });

  return toEventDto(event);
}

export async function updateEvent(
  userId: string,
  eventId: string,
  input: UpdateEventInput,
): Promise<EventDto> {
  const current = await getEventOwned(userId, eventId);

  // Схема сверяет порядок дат, только если пришли обе. Когда меняют
  // одну, сравнивать надо с тем, что уже лежит в базе.
  const startsAt = input.startsAt ?? current.startsAt;
  const endsAt = input.endsAt ?? current.endsAt;
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new ValidationError('Данные не прошли проверку', {
      endsAt: ['Событие должно заканчиваться позже, чем начинается'],
    });
  }

  const event = await prisma.event.update({
    where: { id: eventId },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.startsAt !== undefined && { startsAt: input.startsAt }),
      ...(input.endsAt !== undefined && { endsAt: input.endsAt }),
      ...(input.allDay !== undefined && { allDay: input.allDay }),
      ...(input.timezone !== undefined && { timezone: input.timezone }),
      ...(input.rrule !== undefined && { rrule: input.rrule }),
      ...(input.recurrenceEndsAt !== undefined && { recurrenceEndsAt: input.recurrenceEndsAt }),
      ...(input.color !== undefined && { color: input.color }),
      ...(input.reminderMinutes !== undefined && { reminderMinutes: input.reminderMinutes }),
    },
  });

  return toEventDto(event);
}

/** Удаляет всю серию целиком. Отмена одного вхождения — отдельная операция. */
export async function deleteEvent(userId: string, eventId: string): Promise<void> {
  await getEventOwned(userId, eventId);
  await prisma.event.delete({ where: { id: eventId } });
}

/** Готовый для календаря список вхождений за период. */
export async function listOccurrences(
  userId: string,
  from: Date,
  to: Date,
): Promise<EventOccurrence[]> {
  return expandEvents(await listEventsInRange(userId, from, to), from, to);
}

/**
 * Отменяет одно вхождение серии, не трогая остальные.
 * Повторная отмена того же вхождения ничего не меняет.
 */
export async function cancelOccurrence(
  userId: string,
  eventId: string,
  occurrenceStart: Date,
): Promise<void> {
  await getEventOwned(userId, eventId);

  await prisma.eventException.upsert({
    where: { eventId_originalStart: { eventId, originalStart: occurrenceStart } },
    create: { eventId, originalStart: occurrenceStart, isCancelled: true },
    // Перенесённое вхождение можно отменить: время переноса при этом
    // сбрасывается, чтобы восстановление вернуло его на место по правилу.
    update: { isCancelled: true, startsAt: null, endsAt: null },
  });
}

/** Переносит или переименовывает одно вхождение серии. */
export async function overrideOccurrence(
  userId: string,
  eventId: string,
  input: OverrideOccurrenceInput,
): Promise<void> {
  await getEventOwned(userId, eventId);

  const fields = {
    isCancelled: false,
    ...(input.startsAt !== undefined && { startsAt: input.startsAt }),
    ...(input.endsAt !== undefined && { endsAt: input.endsAt }),
    ...(input.title !== undefined && { title: input.title }),
    ...(input.description !== undefined && { description: input.description }),
  };

  await prisma.eventException.upsert({
    where: { eventId_originalStart: { eventId, originalStart: input.occurrenceStart } },
    create: { eventId, originalStart: input.occurrenceStart, ...fields },
    update: fields,
  });
}

/** Возвращает вхождение к тому, что задаёт правило: снимает отмену и перенос. */
export async function restoreOccurrence(
  userId: string,
  eventId: string,
  occurrenceStart: Date,
): Promise<void> {
  await getEventOwned(userId, eventId);

  await prisma.eventException.deleteMany({
    where: { eventId, originalStart: occurrenceStart },
  });
}
