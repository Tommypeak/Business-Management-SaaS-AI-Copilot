import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LocalUser } from './auth-context.js';

@Injectable()
export class AuthenticatedUserService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(provider: string, subject: string): Promise<LocalUser> {
    const where = { authProvider_authSubject: { authProvider: provider, authSubject: subject } };
    const select = { id: true, createdAt: true } as const;
    const user = await this.prisma.user.findUnique({ where, select });
    if (user) return user;
    try {
      return await this.prisma.user.create({
        data: { authProvider: provider, authSubject: subject },
        select,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.user.findUniqueOrThrow({ where, select });
      }
      throw error;
    }
  }
}
