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

- [x] Этап 0 — каркас монорепо
- [ ] Этап 1 — Prisma и модель данных
- [ ] Этап 2 — аутентификация
- [ ] Этап 3 — CRUD событий
- [ ] Этап 4 — фронт: авторизация и месячная сетка
- [ ] Этап 5 — повторяющиеся события
- [ ] Этап 6 — Web Push
- [ ] Этап 7 — недельный вид и полировка
- [ ] Этап 8 — деплой и CI
