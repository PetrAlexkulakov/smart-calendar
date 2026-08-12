import {
  cancelOccurrenceSchema,
  createEventSchema,
  eventRangeQuerySchema,
  overrideOccurrenceSchema,
  updateEventSchema,
} from '@smart-calendar/shared';
import { Router } from 'express';
import { z } from 'zod';

import { getUserId, requireAuth } from '../../middleware/requireAuth.ts';
import { parseBody, parseParams, parseQuery } from '../../middleware/validate.ts';
import * as eventsService from './events.service.ts';

/** Мусорный id иначе ушёл бы в Prisma и вернулся пятисоткой вместо 400. */
const idParamsSchema = z.object({ id: z.uuid('Некорректный идентификатор события') });

export const eventsRouter = Router();

// Каждый маршрут работает только с событиями текущего пользователя:
// id владельца берётся из токена, а не из тела запроса.
eventsRouter.use(requireAuth);

/**
 * Календарь за период: GET /events?from=...&to=...
 *
 * Отдаёт не события, а их вхождения: повторяющееся событие разворачивается
 * в конкретные даты серии с учётом отмен и переносов.
 */
eventsRouter.get('/', async (req, res) => {
  const { from, to } = parseQuery(req, eventRangeQuerySchema);

  const occurrences = await eventsService.listOccurrences(getUserId(req), from, to);

  res.json({ occurrences });
});

eventsRouter.get('/:id', async (req, res) => {
  const { id } = parseParams(req, idParamsSchema);

  const event = await eventsService.getEventOwned(getUserId(req), id);

  res.json({ event: eventsService.toEventDto(event) });
});

eventsRouter.post('/', async (req, res) => {
  const event = await eventsService.createEvent(getUserId(req), parseBody(req, createEventSchema));

  res.status(201).json({ event });
});

eventsRouter.patch('/:id', async (req, res) => {
  const { id } = parseParams(req, idParamsSchema);

  const event = await eventsService.updateEvent(
    getUserId(req),
    id,
    parseBody(req, updateEventSchema),
  );

  res.json({ event });
});

eventsRouter.delete('/:id', async (req, res) => {
  const { id } = parseParams(req, idParamsSchema);

  await eventsService.deleteEvent(getUserId(req), id);

  res.status(204).end();
});

// --- Операции над отдельным вхождением серии ---
//
// Ключ вхождения — occurrenceStart, время по правилу повторения.
// Он передаётся в теле, а не в пути: ISO-дата содержит двоеточия,
// которые в URL пришлось бы экранировать.

/** «Удалить только это повторение». */
eventsRouter.post('/:id/occurrences/cancel', async (req, res) => {
  const { id } = parseParams(req, idParamsSchema);
  const { occurrenceStart } = parseBody(req, cancelOccurrenceSchema);

  await eventsService.cancelOccurrence(getUserId(req), id, occurrenceStart);

  res.status(204).end();
});

/** «Перенести только это повторение» — а также переименовать его. */
eventsRouter.patch('/:id/occurrences', async (req, res) => {
  const { id } = parseParams(req, idParamsSchema);

  await eventsService.overrideOccurrence(
    getUserId(req),
    id,
    parseBody(req, overrideOccurrenceSchema),
  );

  res.status(204).end();
});

/** Возврат вхождения к правилу: снимает и отмену, и перенос. */
eventsRouter.post('/:id/occurrences/restore', async (req, res) => {
  const { id } = parseParams(req, idParamsSchema);
  const { occurrenceStart } = parseBody(req, cancelOccurrenceSchema);

  await eventsService.restoreOccurrence(getUserId(req), id, occurrenceStart);

  res.status(204).end();
});
