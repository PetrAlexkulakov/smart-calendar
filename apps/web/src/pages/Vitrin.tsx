import type { HealthResponse } from '@smart-calendar/shared';
import { useQuery } from '@tanstack/react-query';

export function Vitrin() {
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
    <div style={{ maxWidth: 940, margin: '0 auto', padding: '48px 24px 96px' }}>
      <header style={{ marginBottom: 'var(--space-8)' }}>
        <h6 style={{ margin: 0, color: 'var(--color-accent)' }}>Smart Calendar / UI</h6>
        <h1 style={{ margin: 0 }}>Умный календарь</h1>
        <p className="text-muted" style={{ maxWidth: 620 }}>
          Дизайн-система Industry перенесена из макета. Настоящие экраны появятся дальше.
        </p>
      </header>

      <Section title="Связь с бэкендом">
        {health.isPending && <p className="text-muted">Проверяем…</p>}
        {health.isError && (
          <p style={{ color: 'var(--color-accent-800)' }}>Нет связи: {health.error.message}</p>
        )}
        {health.data && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span className="tag tag-accent">{health.data.status}</span>
            <span className="text-muted tabular" style={{ fontSize: 13 }}>
              {new Date(health.data.timestamp).toLocaleString('ru-RU')} · аптайм{' '}
              {health.data.uptimeSeconds} с
            </span>
          </div>
        )}
      </Section>

      <Section title="Типографика">
        <h1 style={{ margin: 0 }}>Заголовок первого уровня</h1>
        <h3 style={{ margin: 0 }}>Август 2026</h3>
        <p style={{ margin: 0 }}>
          Обычный текст набирается шрифтом Barlow. Кириллица приходит из Roboto — в Barlow её нет.
        </p>
        <p className="text-muted tabular" style={{ margin: 0 }}>
          09:00 · 14:30 · 21:45 — время выравнено по разрядам
        </p>
      </Section>

      <Section title="Кнопки">
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <button className="btn btn-primary">Событие</button>
          <button className="btn btn-secondary">Сегодня</button>
          <button className="btn btn-ghost">Настроить…</button>
          <button className="btn btn-secondary" disabled>
            Вернуть по правилу
          </button>
        </div>
      </Section>

      <Section title="Переключатель вида">
        <div className="seg">
          {['Месяц', 'Неделя', 'День', 'Список'].map((label, index) => (
            <label className="seg-opt" key={label}>
              <input type="radio" name="view" defaultChecked={index === 0} />
              {label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Форма">
        <div style={{ display: 'grid', gap: 'var(--space-3)', maxWidth: 420 }}>
          <div className="field">
            <label htmlFor="demo-title">Название</label>
            <input id="demo-title" className="input" defaultValue="Спринт-ревью" />
          </div>
          <div className="field">
            <label htmlFor="demo-end">Конец</label>
            <input id="demo-end" className="input" defaultValue="16:00" aria-invalid="true" />
            <div style={{ marginTop: 5, fontSize: 12, color: 'var(--color-accent-800)' }}>
              Событие должно заканчиваться позже, чем начинается
            </div>
          </div>
        </div>
      </Section>

      <Section title="Цвета">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) => (
            <Swatch key={step} token={`--color-accent-${step}`} label={String(step)} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
          {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((step) => (
            <Swatch key={step} token={`--color-neutral-${step}`} label={String(step)} />
          ))}
        </div>
      </Section>

      <Section title="Теги">
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span className="tag tag-accent">Повторяется</span>
          <span className="tag tag-accent-2">Перенесено</span>
          <span className="tag tag-neutral">Europe/Moscow</span>
          <span className="tag tag-outline">Напоминание</span>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 'var(--space-8)' }}>
      <div
        style={{
          borderBottom: '1px solid var(--color-divider)',
          paddingBottom: 'var(--space-2)',
          marginBottom: 'var(--space-4)',
        }}
      >
        <h4 style={{ margin: 0 }}>{title}</h4>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {children}
      </div>
    </section>
  );
}

function Swatch({ token, label }: { token: string; label: string }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          width: 56,
          height: 40,
          background: `var(${token})`,
          border: '1px solid var(--color-divider)',
        }}
      />
      <span className="text-muted" style={{ fontSize: 10 }}>
        {label}
      </span>
    </div>
  );
}
