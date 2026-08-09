/**
 * Общие типы и схемы, которые используют и бэкенд, и фронтенд.
 *
 * Пакет намеренно экспортирует TypeScript-исходники (см. `exports` в package.json):
 * сборка не нужна, tsx и Vite резолвят их напрямую через симлинк npm workspaces.
 */

export * from './api.ts';
export * from './auth.ts';
export * from './events.ts';
