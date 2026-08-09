# Умный календарь

Веб-приложение: события с повторениями (RRULE) и push-уведомлениями перед началом.

Учебный проект — часть кода пишется руками, часть с помощью Claude Code.

## Стек

| Слой        | Решение                                                      |
| ----------- | ------------------------------------------------------------ |
| Фронт       | React 19, Vite 8, TanStack Query, React Router               |
| Бэк         | Node.js 22+, Express 5, Zod                                  |
| БД          | PostgreSQL + Prisma 7 (driver adapter `@prisma/adapter-pg`)  |
| Auth        | Свой JWT: access 15 мин + refresh 30 дней с ротацией, bcrypt |
| Уведомления | Web Push (Service Worker + VAPID)                            |
| Даты        | Luxon, повторения — `rrule` (RFC 5545)                       |
| Тесты       | Vitest, Supertest                                            |

TypeScript везде. Взята версия 6.x, а не 7.x: `typescript-eslint` пока требует `<6.1.0`.

## Структура

```
apps/api        Express + Prisma
apps/web        React + Vite
packages/shared Общие типы и Zod-схемы
```

## Запуск

```bash
npm install
cp .env.example .env      # заполнить DATABASE_URL и секреты
npm run db:generate -w @smart-calendar/api
npm run db:migrate  -w @smart-calendar/api
npm run dev
```

Фронт — http://localhost:5173, API — http://localhost:3000.
Vite проксирует `/api/*` на бэкенд, поэтому в разработке нет CORS-проблем.

Секреты для `.env`:

```bash
# JWT
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# VAPID (понадобится на этапе push-уведомлений)
npx web-push generate-vapid-keys
```

### База данных

Проект работает с любым PostgreSQL. Варианты:

- **Облачный (используется сейчас):** [Neon](https://neon.tech) — connection string кладётся в `DATABASE_URL`.
- **Локальный в Docker:** `npm run db:up` поднимет Postgres 16 из `docker-compose.yml`.

## Скрипты

Корень:

| Команда                     | Что делает                     |
| --------------------------- | ------------------------------ |
| `npm run dev`               | Поднимает API и фронт вместе   |
| `npm run typecheck`         | Проверка типов во всех пакетах |
| `npm run lint` / `lint:fix` | ESLint                         |
| `npm run format`            | Prettier                       |
| `npm test`                  | Тесты                          |
| `npm run db:up` / `db:down` | Postgres в Docker              |

В `apps/api` (через `-w @smart-calendar/api`):

| Команда       | Что делает                      |
| ------------- | ------------------------------- |
| `db:generate` | Генерация Prisma Client         |
| `db:migrate`  | Создать и применить миграцию    |
| `db:deploy`   | Применить миграции (прод)       |
| `db:reset`    | Сбросить базу и накатить заново |
| `db:seed`     | Заполнить тестовыми данными     |
| `db:studio`   | Prisma Studio                   |

## API

Все маршруты, кроме `/health`, `/auth/*` и `/notifications/vapid-public-key`,
требуют заголовок `Authorization: Bearer <access-токен>`.

| Метод            | Маршрут                           | Что делает                                 |
| ---------------- | --------------------------------- | ------------------------------------------ |
| POST             | `/auth/register`                  | Регистрация, ставит refresh-cookie         |
| POST             | `/auth/login`                     | Вход                                       |
| POST             | `/auth/refresh`                   | Обмен refresh-cookie на новый access-токен |
| POST             | `/auth/logout`                    | Выход, гасит сессию                        |
| GET              | `/auth/me`                        | Текущий пользователь                       |
| GET              | `/events?from=&to=`               | Вхождения событий за период                |
| POST             | `/events`                         | Создать событие                            |
| GET/PATCH/DELETE | `/events/:id`                     | Прочитать, изменить, удалить событие       |
| POST             | `/events/:id/occurrences/cancel`  | Удалить одно повторение                    |
| PATCH            | `/events/:id/occurrences`         | Перенести одно повторение                  |
| POST             | `/events/:id/occurrences/restore` | Вернуть повторение к правилу               |
| GET              | `/notifications/vapid-public-key` | Публичный ключ для подписки                |
| POST             | `/notifications/subscribe`        | Сохранить подписку браузера                |
| POST             | `/notifications/unsubscribe`      | Удалить подписку                           |
| GET              | `/notifications/subscriptions`    | Подписанные устройства                     |

Ошибки приходят единым форматом:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": { "endsAt": ["…"] } } }
```

`GET /events` отдаёт **вхождения**, а не события: повторяющееся событие уже
развёрнуто в конкретные даты серии. У всех вхождений серии общий `eventId`,
а `occurrenceStart` — время по правилу; именно он служит ключом при отмене
и переносе отдельного повторения.

## Модель данных

Ключевое решение: **повторяющееся событие — одна строка** в `Event` с правилом
RRULE, а не копия на каждую дату. Вхождения вычисляются на лету при запросе
диапазона. Изменённые и удалённые вхождения серии живут в `EventException`,
ключ вхождения — `originalStart` (время, которое дало бы правило).

`Event.timezone` хранится отдельно от UTC-времени намеренно: встреча
«каждый день в 9:00 по Москве» должна оставаться в 9:00 и после перехода
на летнее время, хотя UTC-смещение при этом меняется.

`SentNotification` защищает от повторной отправки напоминаний после
перезапуска планировщика.

## Ход работы

Бэкенд пишется с помощью Claude Code, фронтенд — руками.

- [x] Этап 0 — каркас монорепо
- [x] Этап 1 — Prisma и модель данных
- [x] Этап 2 — аутентификация
- [x] Этап 3 — CRUD событий
- [ ] Этап 4 — фронт: авторизация и месячная сетка
- [x] Этап 5 — повторяющиеся события (бэкенд; редактор правила — за фронтом)
- [x] Этап 6 — Web Push (бэкенд; Service Worker и подписка — за фронтом)
- [ ] Этап 7 — недельный вид и полировка
- [ ] Этап 8 — деплой и CI

## Про тесты

`npm test -w @smart-calendar/api` — 58 тестов: юнит-тесты раскрытия повторений
(включая переход на летнее время) и интеграционные поверх настоящей базы.

Отдельно есть `npm run check:imports -w @smart-calendar/api`. Vitest прогоняет
код через свой бандлер и сам сглаживает несовместимости CommonJS и ESM, поэтому
зелёные тесты не гарантируют, что приложение вообще запустится в Node. Эта
проверка импортирует модули настоящим рантаймом — на такой ошибке проект уже
один раз спотыкался.
