import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';

describe('AuthService refresh', () => {
  const user: User = {
    id: 'user-1',
    email: 'a@b.com',
    passwordHash: 'x',
    isActive: true,
    isVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makeService(overrides?: {
    findRefresh?: () => Promise<RefreshToken | null>;
  }) {
    const userRepository = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn().mockImplementation(async (u: User) => u),
      create: jest.fn(),
    };
    const refreshTokenRepository = {
      findOne: jest
        .fn()
        .mockImplementation(overrides?.findRefresh ?? (async () => null)),
      create: jest.fn().mockImplementation((row: Partial<RefreshToken>) => row),
      save: jest.fn().mockImplementation(async (row: RefreshToken) => ({
        ...row,
        id: row.id ?? 'rt-new',
      })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const jwtService = {
      signAsync: jest.fn().mockResolvedValue('access.jwt'),
    };
    const accounts = {
      getAccountForUser: jest.fn().mockResolvedValue({ id: 'acc-1' }),
      createPaperAccount: jest.fn().mockResolvedValue({ id: 'acc-1' }),
    };

    const service = new AuthService(
      userRepository as never,
      refreshTokenRepository as never,
      jwtService as unknown as JwtService,
      accounts as never,
    );
    return { service, refreshTokenRepository };
  }

  it('rejects unknown refresh tokens', async () => {
    const { service } = makeService();
    await expect(service.refresh('missing')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('revokes all sessions on reuse of a revoked token', async () => {
    const revoked: RefreshToken = {
      id: 'rt-1',
      userId: user.id,
      tokenHash: 'abc',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
      replacedByTokenId: 'rt-2',
      createdAt: new Date(),
      user,
    };
    const { service, refreshTokenRepository } = makeService({
      findRefresh: async () => revoked,
    });

    await expect(service.refresh('stolen')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(refreshTokenRepository.update).toHaveBeenCalled();
  });
});
