/**
 * Расширение типов Express: сюда middleware складывают данные,
 * которые нужны обработчикам ниже по цепочке.
 */
declare global {
  namespace Express {
    interface Request {
      /** Заполняется requireAuth после проверки access-токена. */
      user?: { id: string };
    }
  }
}

export {};
