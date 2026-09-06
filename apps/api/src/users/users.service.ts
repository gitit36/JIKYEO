import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuthProvider, User } from '@prisma/client';
import { NotFoundError } from '../common/errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';

function newInviteCode(): string {
  return randomBytes(5).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
}

export interface UpsertUserInput {
  authProvider: AuthProvider;
  authSubject: string;
  email?: string | null;
  displayName: string;
  locale?: string;
  timezone?: string;
  birthDate?: Date | null;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertFromAuth(input: UpsertUserInput): Promise<User> {
    return this.prisma.user.upsert({
      where: {
        authProvider_authSubject: {
          authProvider: input.authProvider,
          authSubject: input.authSubject,
        },
      },
      create: {
        authProvider: input.authProvider,
        authSubject: input.authSubject,
        email: input.email ?? null,
        displayName: input.displayName,
        birthDate: input.birthDate ?? null,
        locale: input.locale ?? 'ko-KR',
        timezone: input.timezone ?? 'Asia/Seoul',
        inviteCode: newInviteCode(),
      },
      update: {
        email: input.email ?? undefined,
        displayName: input.displayName,
      },
    });
  }

  async findById(id: string): Promise<User> {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundError('User not found');
    return u;
  }

  isMinor(user: User, referenceDate: Date): boolean {
    if (!user.birthDate) return false;
    const ageMs = referenceDate.getTime() - user.birthDate.getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
    return ageYears < 19; // 만 19세 미만
  }
}
