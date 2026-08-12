import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'apps/api/generated/**',
      // Копия макета: чужой сгенерированный код, править его мы не будем.
      'design/**',
    ],
  },

  js.configs.recommended,

  // Правила, которым нужен доступ к типам. projectService сам находит
  // нужный tsconfig для каждого файла — в монорепо это важно, здесь их четыре.
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Правила, не требующие типов, — для всех файлов.
  {
    plugins: { 'simple-import-sort': simpleImportSort },
    rules: {
      // Импорты сортируются автоматически: Prettier этого не делает,
      // а вручную порядок разъезжается на каждом слиянии веток.
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Правила, которым нужны типы, — только для TypeScript. Иначе они
  // подхватят и сам eslint.config.js, для которого типов нет.
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // import type вместо import — иначе типы попадают в рантайм-бандл.
      '@typescript-eslint/consistent-type-imports': 'error',
      // Забытый await — самая частая причина «тест прошёл, а в проде нет»,
      // особенно в запросах к базе.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  // Конфиги и скрипты на голом JS: типовых правил для них нет.
  {
    files: ['**/*.js', '**/*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    // Именно configs.flat: в configs['recommended-latest'] лежит старый
    // формат, где plugins — массив строк, и ESLint 10 его не принимает.
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
  },

  // Тесты работают с телом HTTP-ответа, а оно у supertest типизировано
  // как any: обращения к response.body.* иначе тонут в предупреждениях.
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Должен идти последним: гасит правила, конфликтующие с Prettier.
  prettier,
);
