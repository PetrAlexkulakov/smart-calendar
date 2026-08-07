import type { HealthResponse } from '@smart-calendar/shared';
import { useQuery } from '@tanstack/react-query';

/**
 * Временная страница-заглушка: её единственная задача на этапе 0 —
 * подтвердить, что фронт, прокси Vite и бэкенд связаны между собой.
 * На этапе 4 она уступит место роутеру и календарю.
 */
export function App() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<HealthResponse> => {
      const response = await fetch('/api/health');
      if (!response.ok) {
        throw new Error(`Бэкенд ответил ${response.status}`);
      }
      return response.json() as Promise<HealthResponse>;
    },
  });

  return (
    <main className="shell">
      <h1>Умный календарь</h1>
      <p className="muted">Каркас проекта готов. Дальше — модель данных и авторизация.</p>

      <section className="card">
        <h2>Связь с бэкендом</h2>
        {health.isPending && <p>Проверяем…</p>}
        {health.isError && <p className="error">Нет связи: {health.error.message}</p>}
        {health.data && (
          <dl>
            <dt>Статус</dt>
            <dd>{health.data.status}</dd>
            <dt>Время сервера</dt>
            <dd>{new Date(health.data.timestamp).toLocaleString('ru-RU')}</dd>
            <dt>Аптайм</dt>
            <dd>{health.data.uptimeSeconds} с</dd>
          </dl>
        )}
      </section>
    </main>
  );
}
