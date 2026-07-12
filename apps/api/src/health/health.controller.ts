import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';

type Indicator = { status: 'up' | 'down' };

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private http: HttpService,
    private prisma: PrismaService,
    @Inject('REDIS_CLIENT') private redis: Redis,
  ) {}

  // Sonde de disponibilité utilisée par Railway/Docker. Seule la base de
  // données est *critique* : sans elle l'API ne peut rien faire, on renvoie
  // donc 503. Redis (throttling) et le service ML (scan ALPR) sont
  // *optionnels* — l'API démarre et sert le trafic même s'ils sont absents,
  // ce qui évite un échec de déploiement quand ils ne sont pas provisionnés
  // (cas typique sur Railway où seul l'API + Supabase sont déployés).
  @Get()
  async check() {
    const details: Record<string, Indicator> = {};

    // Base de données — critique.
    let dbUp = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      details.database = { status: 'up' };
    } catch {
      dbUp = false;
      details.database = { status: 'down' };
    }

    // Redis — optionnel (throttling distribué).
    try {
      const pong = await this.redis.ping();
      details.redis = { status: pong === 'PONG' ? 'up' : 'down' };
    } catch {
      details.redis = { status: 'down' };
    }

    // Service ML — optionnel (reconnaissance de plaques).
    try {
      const mlUrl = process.env.ML_SERVICE_URL ?? 'http://localhost:8000';
      await firstValueFrom(this.http.get(`${mlUrl}/health`, { timeout: 3000 }));
      details['ml-service'] = { status: 'up' };
    } catch {
      details['ml-service'] = { status: 'down' };
    }

    const body = { status: dbUp ? 'ok' : 'error', info: details, error: {}, details };
    if (!dbUp) {
      // 503 uniquement si la base est injoignable.
      throw new ServiceUnavailableException(body);
    }
    return body;
  }
}
