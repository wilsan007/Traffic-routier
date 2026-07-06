import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheckService,
  HttpHealthIndicator,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
    private prisma: PrismaService,
    @Inject('REDIS_CLIENT') private redis: Redis,
  ) {}

  @Get()
  check() {
    return this.health.check([
      () =>
        this.http.pingCheck(
          'ml-service',
          `${process.env.ML_SERVICE_URL ?? 'http://localhost:8000'}/health`,
        ),
      async () => {
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return { prisma: { status: 'up' } };
        } catch {
          return { prisma: { status: 'down' } };
        }
      },
      async () => {
        try {
          const pong = await this.redis.ping();
          return { redis: { status: pong === 'PONG' ? 'up' : 'down' } };
        } catch {
          return { redis: { status: 'down' } };
        }
      },
    ]);
  }
}
