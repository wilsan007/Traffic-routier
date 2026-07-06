import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisCacheService } from '../redis/redis-cache.service';
import { CreateHotlistEntryDto } from './dto/create-hotlist-entry.dto';

@Injectable()
export class HotlistService {
  constructor(
    private prisma: PrismaService,
    private cache: RedisCacheService,
  ) {}

  async create(dto: CreateHotlistEntryDto, createdById: string) {
    const plateNumber = dto.plateNumber.toUpperCase().replace(/\s+/g, '');
    const entry = await this.prisma.hotlistEntry.create({
      data: { ...dto, plateNumber, createdById },
    });
    await this.cache.delPattern('hotlist:match:*');
    await this.cache.del('hotlist:active');
    return entry;
  }

  async findAll(activeOnly = false) {
    if (activeOnly) {
      const cached = await this.cache.get<Awaited<ReturnType<typeof this.prisma.hotlistEntry.findMany>>>('hotlist:active');
      if (cached) return cached;
    }
    const result = await this.prisma.hotlistEntry.findMany({
      where: activeOnly ? { active: true } : undefined,
      include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (activeOnly) {
      await this.cache.set('hotlist:active', result, 60);
    }
    return result;
  }

  async findOne(id: string) {
    const entry = await this.prisma.hotlistEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Entrée hotlist introuvable');
    return entry;
  }

  async deactivate(id: string) {
    await this.findOne(id);
    const entry = await this.prisma.hotlistEntry.update({ where: { id }, data: { active: false } });
    await this.cache.delPattern('hotlist:match:*');
    await this.cache.del('hotlist:active');
    return entry;
  }

  // Retourne toutes les entrées actives et non expirées pour une plaque donnée
  async matchPlate(plateNormalized: string) {
    const cacheKey = `hotlist:match:${plateNormalized}`;
    const cached = await this.cache.get<Awaited<ReturnType<typeof this.prisma.hotlistEntry.findMany>>>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const result = await this.prisma.hotlistEntry.findMany({
      where: {
        plateNumber: plateNormalized,
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    });
    await this.cache.set(cacheKey, result, 30);
    return result;
  }
}
