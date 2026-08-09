/**
 * Интеграционные тесты аутентификации: приложение поднимается целиком
 * и работает с настоящей базой.
 *
 * Тесты не чистят базу целиком — иначе снесли бы данные из seed. Вместо
 * этого каждый заводит пользователя со случайным email и удаляет его
 * за собой; всё остальное уходит по каскаду.
 */
import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../../app.ts';
import { disconnectPrisma, prisma } from '../../lib/prisma.ts';

const app = createApp();
const createdEmails: string[] = [];

function uniqueEmail(): string {
  const email = `test-${randomUUID()}@example.com`;
  createdEmails.push(email);
  return email;
}

/** Достаёт значение refresh-cookie из заголовка ответа. */
function extractRefreshCookie(response: request.Response): string {
  const raw = response.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw];
  const cookie = cookies.find(
    (value) => typeof value === 'string' && value.startsWith('refreshToken='),
  );

  if (!cookie) {
    throw new Error('В ответе нет cookie refreshToken');
  }
  return cookie.split(';')[0]!;
}

async function registerUser(password = 'password123') {
  const email = uniqueEmail();
  const response = await request(app).post('/auth/register').send({ email, password });

  expect(response.status).toBe(201);
  return { email, password, response };
}

beforeAll(async () => {
  // Убеждаемся, что база доступна: иначе тесты падали бы по таймауту
  // с невнятной ошибкой.
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  if (createdEmails.length > 0) {
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  }
  await disconnectPrisma();
});

describe('POST /auth/register', () => {
  it('создаёт пользователя, отдаёт access-токен и ставит refresh-cookie', async () => {
    const { email, response } = await registerUser();

    expect(response.body.user).toMatchObject({ email });
    expect(response.body.user).not.toHaveProperty('passwordHash');
    expect(typeof response.body.accessToken).toBe('string');

    const cookie = extractRefreshCookie(response);
    expect(cookie).toContain('refreshToken=');

    const rawCookies = response.headers['set-cookie'] as unknown as string[];
    expect(rawCookies[0]).toContain('HttpOnly');
  });

  it('не отдаёт хеш пароля и не принимает второй раз тот же email', async () => {
    const { email, password } = await registerUser();

    const duplicate = await request(app).post('/auth/register').send({ email, password });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
  });

  it('отклоняет короткий пароль и некорректный email', async () => {
    const short = await request(app)
      .post('/auth/register')
      .send({ email: uniqueEmail(), password: 'x' });

    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('VALIDATION_ERROR');
    expect(short.body.error.details).toHaveProperty('password');

    const badEmail = await request(app)
      .post('/auth/register')
      .send({ email: 'не-email', password: 'password123' });

    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error.details).toHaveProperty('email');
  });
});

describe('POST /auth/login', () => {
  it('пускает с верным паролем', async () => {
    const { email, password } = await registerUser();

    const response = await request(app).post('/auth/login').send({ email, password });

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(email);
    expect(typeof response.body.accessToken).toBe('string');
  });

  it('не различает неверный пароль и несуществующий email', async () => {
    const { email } = await registerUser();

    const wrongPassword = await request(app)
      .post('/auth/login')
      .send({ email, password: 'wrong-password' });
    const noSuchUser = await request(app)
      .post('/auth/login')
      .send({ email: `missing-${randomUUID()}@example.com`, password: 'password123' });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    // Одинаковый текст важен: иначе по ответу можно узнать,
    // какие адреса зарегистрированы.
    expect(wrongPassword.body.error.message).toBe(noSuchUser.body.error.message);
  });
});

describe('GET /auth/me', () => {
  it('требует токен', async () => {
    const response = await request(app).get('/auth/me');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('отдаёт текущего пользователя по access-токену', async () => {
    const { email, response: registered } = await registerUser();

    const response = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${registered.body.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(email);
  });

  it('отклоняет мусорный токен', async () => {
    const response = await request(app).get('/auth/me').set('Authorization', 'Bearer not-a-token');

    expect(response.status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('обменивает cookie на новый access-токен и выдаёт новую cookie', async () => {
    const { response: registered } = await registerUser();
    const firstCookie = extractRefreshCookie(registered);

    const refreshed = await request(app).post('/auth/refresh').set('Cookie', firstCookie);

    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.accessToken).toBe('string');

    const secondCookie = extractRefreshCookie(refreshed);
    expect(secondCookie).not.toBe(firstCookie);
  });

  it('без cookie отвечает 401', async () => {
    const response = await request(app).post('/auth/refresh');

    expect(response.status).toBe(401);
  });

  it('при повторном использовании старого токена гасит все сессии', async () => {
    const { response: registered } = await registerUser();
    const stolenCookie = extractRefreshCookie(registered);

    const refreshed = await request(app).post('/auth/refresh').set('Cookie', stolenCookie);
    const freshCookie = extractRefreshCookie(refreshed);

    // Второй обмен тем же токеном — признак того, что копия у кого-то ещё.
    const replay = await request(app).post('/auth/refresh').set('Cookie', stolenCookie);
    expect(replay.status).toBe(401);

    // Выданный до этого токен тоже должен перестать работать.
    const afterBreach = await request(app).post('/auth/refresh').set('Cookie', freshCookie);
    expect(afterBreach.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('гасит сессию и отвечает успехом даже без cookie', async () => {
    const { response: registered } = await registerUser();
    const cookie = extractRefreshCookie(registered);

    const loggedOut = await request(app).post('/auth/logout').set('Cookie', cookie);
    expect(loggedOut.status).toBe(204);

    const afterLogout = await request(app).post('/auth/refresh').set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);

    const withoutCookie = await request(app).post('/auth/logout');
    expect(withoutCookie.status).toBe(204);
  });
});

describe('обработка неизвестных маршрутов', () => {
  it('отдаёт 404 в общем формате ошибки', async () => {
    const response = await request(app).get('/no-such-route');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
