import type { AuthUser, LoginInput, RegisterInput } from '@smart-calendar/shared';
import bcrypt from 'bcrypt';

import { ConflictError, UnauthorizedError } from '../../lib/errors.ts';
import { prisma } from '../../lib/prisma.ts';
import { issueRefreshToken, signAccessToken } from './tokens.ts';

const BCRYPT_ROUNDS = 12;

/**
 * Хеш несуществующего пароля. Нужен, чтобы вход с незарегистрированным
 * email занимал столько же времени, сколько с настоящим: иначе по времени
 * ответа можно перебирать, какие адреса зарегистрированы.
 */
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-equalization', BCRYPT_ROUNDS);

interface AuthResult {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}

function toAuthUser(user: { id: string; email: string; timezone: string }): AuthUser {
  return { id: user.id, email: user.email, timezone: user.timezone };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const email = input.email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    throw new ConflictError('Пользователь с таким email уже зарегистрирован');
  }

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      ...(input.timezone && { timezone: input.timezone }),
    },
  });

  return {
    user: toAuthUser(user),
    accessToken: signAccessToken(user.id),
    refreshToken: await issueRefreshToken(user.id),
  };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const email = input.email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email } });

  // Сообщение одно и то же для «нет такого email» и «неверный пароль»:
  // разные тексты подсказали бы, какие адреса существуют.
  const passwordMatches = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordMatches) {
    throw new UnauthorizedError('Неверный email или пароль');
  }

  return {
    user: toAuthUser(user),
    accessToken: signAccessToken(user.id),
    refreshToken: await issueRefreshToken(user.id),
  };
}

export async function getUserById(id: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, timezone: true },
  });

  // Токен валиден, но пользователя больше нет — например, аккаунт удалён.
  if (!user) {
    throw new UnauthorizedError('Пользователь не найден');
  }
  return user;
}
