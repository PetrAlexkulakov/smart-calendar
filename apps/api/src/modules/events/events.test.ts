/**
 * Интеграционные тесты CRUD событий. Главное, что здесь проверяется, —
 * изоляция: пользователь не должен видеть, править или удалять чужие
 * события ни при каких обстоятельствах.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../app.ts';
import { disconnectPrisma, prisma } from '../../lib/prisma.ts';

const app = createApp();
const createdEmails: string[] = [];

/** Регистрирует пользователя и возвращает его access-токен. */
async function createUser(): Promise<{ token: string; email: string }> {
  const email = `events-test-${randomUUID()}@example.com`;
  createdEmails.push(email);

  const response = await request(app)
    .post('/auth/register')
    .send({ email, password: 'password123' });

  expect(response.status).toBe(201);
  return { token: response.body.accessToken as string, email };
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Тестовое событие',
    startsAt: '2026-09-01T09:00:00.000Z',
    endsAt: '2026-09-01T10:00:00.000Z',
    timezone: 'Europe/Moscow',
    ...overrides,
  };
}

let alice: { token: string; email: string };
let bob: { token: string; email: string };

beforeAll(async () => {
  alice = await createUser();
  bob = await createUser();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  await disconnectPrisma();
});

describe('авторизация на маршрутах событий', () => {
  it('без токена не пускает никуда', async () => {
    const list = await request(app).get('/events?from=2026-09-01&to=2026-09-30');
    const create = await request(app).post('/events').send(validEvent());

    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
  });
});

describe('POST /events', () => {
  it('создаёт событие и проставляет значения по умолчанию', async () => {
    const response = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(validEvent());

    expect(response.status).toBe(201);
    expect(response.body.event).toMatchObject({
      title: 'Тестовое событие',
      allDay: false,
      color: '#4f46e5',
      rrule: null,
    });
    expect(response.body.event.reminderMinutes).toEqual([]);
  });

  it('отклоняет событие, которое кончается раньше, чем начинается', async () => {
    const response = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(validEvent({ endsAt: '2026-09-01T08:00:00.000Z' }));

    expect(response.status).toBe(400);
    expect(response.body.error.details).toHaveProperty('endsAt');
  });

  it('отклоняет несуществующую таймзону', async () => {
    const response = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(validEvent({ timezone: 'Europe/Атлантида' }));

    expect(response.status).toBe(400);
    expect(response.body.error.details).toHaveProperty('timezone');
  });

  it('отклоняет пустой заголовок и кривой цвет', async () => {
    const noTitle = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(validEvent({ title: '   ' }));
    const badColor = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(validEvent({ color: 'красный' }));

    expect(noTitle.status).toBe(400);
    expect(badColor.status).toBe(400);
  });

  it('принимает напоминания и правило повторения', async () => {
    const response = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(
        validEvent({
          rrule: 'FREQ=WEEKLY;BYDAY=MO',
          reminderMinutes: [10, 60],
          color: '#ff8800',
        }),
      );

    expect(response.status).toBe(201);
    expect(response.body.event.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(response.body.event.reminderMinutes).toEqual([10, 60]);
  });

  it('не принимает повторяющиеся напоминания', async () => {
    const response = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(validEvent({ reminderMinutes: [10, 10] }));

    expect(response.status).toBe(400);
  });
});

describe('GET /events', () => {
  it('требует корректный диапазон дат', async () => {
    const noRange = await request(app).get('/events').set('Authorization', `Bearer ${alice.token}`);
    const reversed = await request(app)
      .get('/events?from=2026-09-30&to=2026-09-01')
      .set('Authorization', `Bearer ${alice.token}`);
    const tooWide = await request(app)
      .get('/events?from=2020-01-01&to=2030-01-01')
      .set('Authorization', `Bearer ${alice.token}`);

    expect(noRange.status).toBe(400);
    expect(reversed.status).toBe(400);
    expect(tooWide.status).toBe(400);
  });

  it('отдаёт события, попадающие в диапазон, и отсекает остальные', async () => {
    const inRange = await request(app)
      .get('/events?from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z')
      .set('Authorization', `Bearer ${alice.token}`);
    const outOfRange = await request(app)
      .get('/events?from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z')
      .set('Authorization', `Bearer ${alice.token}`);

    expect(inRange.status).toBe(200);
    expect(inRange.body.events.length).toBeGreaterThan(0);
    // Повторяющееся событие из предыдущего теста продолжается и в ноябре,
    // а вот разовые сентябрьские сюда попасть не должны.
    expect(
      outOfRange.body.events.every((event: { rrule: string | null }) => event.rrule !== null),
    ).toBe(true);
  });

  it('показывает только свои события', async () => {
    const response = await request(app)
      .get('/events?from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z')
      .set('Authorization', `Bearer ${bob.token}`);

    expect(response.status).toBe(200);
    expect(response.body.events).toEqual([]);
  });
});

describe('доступ к чужим событиям', () => {
  it('чужое событие неотличимо от несуществующего', async () => {
    const created = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(validEvent({ title: 'Личное событие Алисы' }));
    const eventId = created.body.event.id as string;

    const read = await request(app)
      .get(`/events/${eventId}`)
      .set('Authorization', `Bearer ${bob.token}`);
    const update = await request(app)
      .patch(`/events/${eventId}`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ title: 'Взломано' });
    const remove = await request(app)
      .delete(`/events/${eventId}`)
      .set('Authorization', `Bearer ${bob.token}`);

    expect(read.status).toBe(404);
    expect(update.status).toBe(404);
    expect(remove.status).toBe(404);

    // И событие осталось нетронутым.
    const stillThere = await request(app)
      .get(`/events/${eventId}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(stillThere.body.event.title).toBe('Личное событие Алисы');
  });

  it('на мусорный id отвечает 400, а не пятисоткой', async () => {
    const response = await request(app)
      .get('/events/не-uuid')
      .set('Authorization', `Bearer ${alice.token}`);

    expect(response.status).toBe(400);
  });

  it('на несуществующий, но валидный id отвечает 404', async () => {
    const response = await request(app)
      .get(`/events/${randomUUID()}`)
      .set('Authorization', `Bearer ${alice.token}`);

    expect(response.status).toBe(404);
  });
});

describe('PATCH и DELETE /events/:id', () => {
  it('меняет отдельные поля, не трогая остальные', async () => {
    const created = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(
        validEvent({
          title: 'До правки',
          reminderMinutes: [15],
          color: '#ff8800',
          allDay: true,
        }),
      );
    const eventId = created.body.event.id as string;

    const updated = await request(app)
      .patch(`/events/${eventId}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ title: 'После правки' });

    expect(updated.status).toBe(200);
    expect(updated.body.event.title).toBe('После правки');
    // Поля, которых не было в запросе, обязаны сохраниться: у схемы
    // обновления не должно быть значений по умолчанию.
    expect(updated.body.event.reminderMinutes).toEqual([15]);
    expect(updated.body.event.color).toBe('#ff8800');
    expect(updated.body.event.allDay).toBe(true);
    expect(updated.body.event.startsAt).toBe(created.body.event.startsAt);
  });

  it('не даёт сдвинуть начало за конец события', async () => {
    const created = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(validEvent());

    // Прислано только одно поле — проверять порядок дат надо
    // относительно того, что уже лежит в базе.
    const updated = await request(app)
      .patch(`/events/${created.body.event.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ startsAt: '2026-09-01T23:00:00.000Z' });

    expect(updated.status).toBe(400);
    expect(updated.body.error.details).toHaveProperty('endsAt');
  });

  it('удаляет событие', async () => {
    const created = await request(app)
      .post('/events')
      .set('Authorization', `Bearer ${alice.token}`)
      .send(validEvent({ title: 'На удаление' }));
    const eventId = created.body.event.id as string;

    const removed = await request(app)
      .delete(`/events/${eventId}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(removed.status).toBe(204);

    const afterDelete = await request(app)
      .get(`/events/${eventId}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(afterDelete.status).toBe(404);
  });
});
