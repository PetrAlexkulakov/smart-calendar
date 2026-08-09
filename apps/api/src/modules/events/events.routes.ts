import type { EventRangeQuery } from '@smart-calendar/shared';
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
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import * as eventsService from './events.service.ts';

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
eventsRouter.get('/', validateQuery(eventRangeQuerySchema), async (req, res) => {
  const { from, to } = req.validatedQuery as EventRangeQuery;

  const occurrences = await eventsService.listOccurrences(getUserId(req), from, to);

  res.json({ occurrences });
});

eventsRouter.get('/:id', validateParams(idParamsSchema), async (req, res) => {
  const { id } = req.validatedParams as { id: string };

  const event = await eventsService.getEventOwned(getUserId(req), id);

  res.json({ event: eventsService.toEventDto(event) });
});

eventsRouter.post('/', validateBody(createEventSchema), async (req, res) => {
  const event = await eventsService.createEvent(getUserId(req), req.body);

  res.status(201).json({ event });
});

eventsRouter.patch(
  '/:id',
  validateParams(idParamsSchema),
  validateBody(updateEventSchema),
  async (req, res) => {
    const { id } = req.validatedParams as { id: string };

    const event = await eventsService.updateEvent(getUserId(req), id, req.body);

    res.json({ event });
  },
);

eventsRouter.delete('/:id', validateParams(idParamsSchema), async (req, res) => {
  const { id } = req.validatedParams as { id: string };

  await eventsService.deleteEvent(getUserId(req), id);

  res.status(204).end();
});

// --- Операции над отдельным вхождением серии ---
//
// Ключ вхождения — occurrenceStart, время по правилу повторения.
// Он передаётся в теле, а не в пути: ISO-дата содержит двоеточия,
// которые в URL пришлось бы экранировать.

/** «Удалить только это повторение». */
eventsRouter.post(
  '/:id/occurrences/cancel',
  validateParams(idParamsSchema),
  validateBody(cancelOccurrenceSchema),
  async (req, res) => {
    const { id } = req.validatedParams as { id: string };

    await eventsService.cancelOccurrence(getUserId(req), id, req.body.occurrenceStart);

    res.status(204).end();
  },
);

/** «Перенести только это повторение» — а также переименовать его. */
eventsRouter.patch(
  '/:id/occurrences',
  validateParams(idParamsSchema),
  validateBody(overrideOccurrenceSchema),
  async (req, res) => {
    const { id } = req.validatedParams as { id: string };

    await eventsService.overrideOccurrence(getUserId(req), id, req.body);

    res.status(204).end();
  },
);

/** Возврат вхождения к правилу: снимает и отмену, и перенос. */
eventsRouter.post(
  '/:id/occurrences/restore',
  validateParams(idParamsSchema),
  validateBody(cancelOccurrenceSchema),
  async (req, res) => {
    const { id } = req.validatedParams as { id: string };

    await eventsService.restoreOccurrence(getUserId(req), id, req.body.occurrenceStart);

    res.status(204).end();
  },
);
