import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock } };
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };
  let audit: { log: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() } };
    jwt = {
      signAsync: jest.fn().mockResolvedValue('mock-token'),
      verifyAsync: jest.fn().mockResolvedValue({ sub: '1', type: 'refresh' }),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    config = { get: jest.fn().mockReturnValue('test-secret') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: AuditService, useValue: audit },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should throw UnauthorizedException if user not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.login('test@test.com', 'pass')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException if user is inactive', async () => {
    const hash = await argon2.hash('Password123!');
    prisma.user.findUnique.mockResolvedValue({
      id: '1',
      email: 'test@test.com',
      passwordHash: hash,
      active: false,
      role: 'OFFICER',
    });
    await expect(service.login('test@test.com', 'Password123!')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should throw UnauthorizedException if password is wrong', async () => {
    const hash = await argon2.hash('Password123!');
    prisma.user.findUnique.mockResolvedValue({
      id: '1',
      email: 'test@test.com',
      passwordHash: hash,
      active: true,
      role: 'OFFICER',
    });
    await expect(service.login('test@test.com', 'wrong-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should return accessToken and user on successful login', async () => {
    const hash = await argon2.hash('Password123!');
    const mockUser = {
      id: '1',
      email: 'test@test.com',
      passwordHash: hash,
      active: true,
      role: 'OFFICER',
      firstName: 'Test',
      lastName: 'User',
      badgeNumber: 'BADGE-001',
    };
    prisma.user.findUnique.mockResolvedValue(mockUser);

    const result = await service.login('test@test.com', 'Password123!', '127.0.0.1');

    expect(result.accessToken).toBe('mock-token');
    expect(result.user.email).toBe('test@test.com');
    expect(result.user.firstName).toBe('Test');
    expect(jwt.signAsync).toHaveBeenCalledWith({
      sub: '1',
      email: 'test@test.com',
      role: 'OFFICER',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOGIN', userId: '1', ipAddress: '127.0.0.1' }),
    );
  });

  it('should hash a password', async () => {
    const hash = await AuthService.hashPassword('mypassword');
    expect(await argon2.verify(hash, 'mypassword')).toBe(true);
  });

  it('should refresh token successfully', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: '1',
      email: 'test@test.com',
      active: true,
      role: 'OFFICER',
    });

    const result = await service.refresh('valid-refresh-token');

    expect(result.accessToken).toBe('mock-token');
    expect(jwt.verifyAsync).toHaveBeenCalled();
  });

  it('should throw on invalid refresh token', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('invalid'));
    await expect(service.refresh('invalid-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
