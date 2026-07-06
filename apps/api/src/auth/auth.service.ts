import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  async login(email: string, password: string, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.active) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const passwordValid = await argon2.verify(user.passwordHash, password);
    if (!passwordValid) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, type: 'refresh' },
      {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? this.config.get<string>('JWT_SECRET') ?? 'change-me-refresh-secret',
        expiresIn: this.config.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d',
      },
    );

    await this.audit.log({
      userId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      ipAddress,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        badgeNumber: user.badgeNumber,
      },
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? this.config.get<string>('JWT_SECRET') ?? 'change-me-refresh-secret',
      });

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Token invalide');
      }

      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.active) {
        throw new UnauthorizedException('Utilisateur invalide');
      }

      const accessToken = await this.jwt.signAsync({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      return { accessToken };
    } catch {
      throw new UnauthorizedException('Refresh token invalide ou expiré');
    }
  }

  static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }
}
