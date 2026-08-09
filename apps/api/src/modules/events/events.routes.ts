import type { EventRangeQuery } from '@smart-calendar/shared';
import {
  createEventSchema,
  eventRangeQuerySchema,
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

/** Календарь за период: GET /events?from=...&to=... */
eventsRouter.get('/', validateQuery(eventRangeQuerySchema), async (req, res) => {
  const { from, to } = req.validatedQuery as EventRangeQuery;

  const events = await eventsService.listEventsInRange(getUserId(req), from, to);

  // На этапе повторений здесь появится раскрытие RRULE в отдельные вхождения.
  res.json({ events: events.map(eventsService.toEventDto) });
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
