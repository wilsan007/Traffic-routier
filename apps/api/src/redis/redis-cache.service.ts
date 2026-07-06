import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisCacheService implements OnModuleDestroy {
  constructor(@Inject('REDIS_CLIENT') private redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const val = await this.redis.get(key);
    if (!val) return null;
    try {
      return JSON.parse(val) as T;
    } catch {
      return val as unknown as T;
    }
  }

  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.redis.set(key, serialized, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async delPattern(pattern: string): Promise<void> {
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
