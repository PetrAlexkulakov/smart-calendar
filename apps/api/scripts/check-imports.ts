/**
 * Проверяет, что модули приложения грузятся в настоящем окружении Node.
 *
 * Зачем это нужно отдельно от тестов: Vitest прогоняет код через свой
 * бандлер и сам чинит несовместимости CommonJS и ESM. Из-за этого пакет
 * вроде rrule (CJS-сборка для Node, ESM-сборка для Vite) в тестах
 * импортируется успешно, а на реальном запуске падает с
 * «does not provide an export named». Один раз мы на это уже наступили.
 *
 * Запуск: npm run check:imports -w @smart-calendar/api
 */
const modules = [
  '../src/app.ts',
  '../src/lib/recurrence.ts',
  '../src/modules/notifications/scheduler.ts',
  '../src/modules/notifications/push.ts',
];

let failed = false;

for (const path of modules) {
  try {
    await import(new URL(path, import.meta.url).href);
    console.log(`  ok   ${path}`);
  } catch (error) {
    failed = true;
    console.error(`  FAIL ${path}`);
    console.error(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failed) {
  console.error('\nНе все модули загрузились в Node.');
  process.exit(1);
}

console.log('\nВсе модули загружаются в Node.');
process.exit(0);
