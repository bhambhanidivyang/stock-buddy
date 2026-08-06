import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import { compare, hash } from 'bcrypt';
import { IsNull, Repository } from 'typeorm';
import { LoginDto } from './dtos/login.dto';
import { RegisterDto } from './dtos/register.dto';
import { UserResponseDto } from './dtos/user-response.dto';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { AccountService } from '../account/account.service';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthSession = {
  user: UserResponseDto;
  accessToken: string;
  refreshToken: string;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokenRepository: Repository<RefreshToken>,
    private readonly jwtService: JwtService,
    private readonly accounts: AccountService,
  ) {}

  async login(loginDto: LoginDto): Promise<AuthSession> {
    const { email, password } = loginDto;

    const user = await this.userRepository.findOne({
      where: { email },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const isPasswordValid = await compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }
    user.lastLoginAt = new Date();
    await this.userRepository.save(user);
    await this.accounts.getAccountForUser(user.id);

    return this.toAuthSession(user);
  }

  async register(registerDto: RegisterDto): Promise<AuthSession> {
    const { email, firstName, lastName, password } = registerDto;

    const existingUser = await this.userRepository.findOne({
      where: { email },
    });
    if (existingUser) {
      throw new BadRequestException('Email already in use');
    }

    const passwordHash = await hash(password, 10);
    const user = this.userRepository.create({
      email,
      firstName,
      lastName,
      passwordHash,
      lastLoginAt: new Date(),
    });
    const saved = await this.userRepository.save(user);
    await this.accounts.createPaperAccount(saved.id);

    return this.toAuthSession(saved);
  }

  async refresh(rawRefreshToken: string): Promise<AuthSession> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const existing = await this.refreshTokenRepository.findOne({
      where: { tokenHash },
    });

    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.revokedAt) {
      // Reuse of a rotated/revoked token → revoke all sessions for that user
      await this.revokeAllForUser(existing.userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      existing.revokedAt = new Date();
      await this.refreshTokenRepository.save(existing);
      throw new UnauthorizedException('Refresh token expired');
    }

    const user = await this.userRepository.findOne({
      where: { id: existing.userId },
    });
    if (!user || !user.isActive) {
      await this.revokeAllForUser(existing.userId);
      throw new UnauthorizedException('Invalid refresh token');
    }

    const session = await this.toAuthSession(user);
    const replacement = await this.refreshTokenRepository.findOne({
      where: { tokenHash: this.hashToken(session.refreshToken) },
    });

    existing.revokedAt = new Date();
    existing.replacedByTokenId = replacement?.id ?? null;
    await this.refreshTokenRepository.save(existing);

    return session;
  }

  async logout(rawRefreshToken: string | undefined, userId: string): Promise<{ ok: true }> {
    if (rawRefreshToken) {
      const tokenHash = this.hashToken(rawRefreshToken);
      const existing = await this.refreshTokenRepository.findOne({
        where: { tokenHash, userId },
      });
      if (existing && !existing.revokedAt) {
        existing.revokedAt = new Date();
        await this.refreshTokenRepository.save(existing);
      }
      return { ok: true };
    }

    await this.revokeAllForUser(userId);
    return { ok: true };
  }

  async me(user: User): Promise<UserResponseDto> {
    return {
      email: user.email,
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
    };
  }

  private async toAuthSession(user: User): Promise<AuthSession> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
    };
    const accessToken = await this.jwtService.signAsync(payload);
    const refreshToken = await this.issueRefreshToken(user.id);

    return {
      user: {
        email: user.email,
        firstName: user.firstName ?? '',
        lastName: user.lastName ?? '',
      },
      accessToken,
      refreshToken,
    };
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    const tokenHash = this.hashToken(raw);
    const entity = this.refreshTokenRepository.create({
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      revokedAt: null,
      replacedByTokenId: null,
    });
    await this.refreshTokenRepository.save(entity);
    return raw;
  }

  private async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokenRepository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
