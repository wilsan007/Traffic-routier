import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisCacheService } from '../redis/redis-cache.service';

@Injectable()
export class AnalyticsService {
  constructor(
    private prisma: PrismaService,
    private cache: RedisCacheService,
  ) {}

  async infractionsByType(from?: string, to?: string) {
    const cacheKey = `analytics:infractionsByType:${from ?? 'all'}:${to ?? 'all'}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const result = await this.prisma.infraction.groupBy({
      by: ['type'],
      _count: { _all: true },
      where: {
        occurredAt: {
          gte: from ? new Date(from) : undefined,
          lte: to ? new Date(to) : undefined,
        },
      },
      orderBy: { _count: { type: 'desc' } },
    });
    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  async infractionsBySeverity() {
    const cacheKey = 'analytics:infractionsBySeverity';
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const result = await this.prisma.infraction.groupBy({
      by: ['severity'],
      _count: { _all: true },
    });
    await this.cache.set(cacheKey, result, 120);
    return result;
  }

  async captureVolumeByDay(days = 30) {
    const cacheKey = `analytics:captureVolumeByDay:${days}`;
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const since = new Date();
    since.setDate(since.getDate() - days);
    const captures = await this.prisma.capture.findMany({
      where: { capturedAt: { gte: since } },
      select: { capturedAt: true },
    });
    const buckets: Record<string, number> = {};
    for (const c of captures) {
      const day = c.capturedAt.toISOString().slice(0, 10);
      buckets[day] = (buckets[day] ?? 0) + 1;
    }
    const result = Object.entries(buckets)
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day));
    await this.cache.set(cacheKey, result, 300);
    return result;
  }

  async alertsByPriority() {
    const cacheKey = 'analytics:alertsByPriority';
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const alerts = await this.prisma.alert.findMany({
      include: { hotlistEntry: { select: { priority: true } } },
    });
    const buckets: Record<string, number> = {};
    for (const a of alerts) {
      const p = a.hotlistEntry.priority;
      buckets[p] = (buckets[p] ?? 0) + 1;
    }
    await this.cache.set(cacheKey, buckets, 120);
    return buckets;
  }

  async overview() {
    const cacheKey = 'analytics:overview';
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    const [vehicles, owners, activeHotlist, openCases, newAlerts, capturesToday] = await Promise.all([
      this.prisma.vehicle.count(),
      this.prisma.owner.count(),
      this.prisma.hotlistEntry.count({ where: { active: true } }),
      this.prisma.case.count({ where: { status: { not: 'CLOSED' } } }),
      this.prisma.alert.count({ where: { status: 'NEW' } }),
      this.prisma.capture.count({
        where: { capturedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
      }),
    ]);
    const result = { vehicles, owners, activeHotlist, openCases, newAlerts, capturesToday };
    await this.cache.set(cacheKey, result, 60);
    return result;
  }
}
