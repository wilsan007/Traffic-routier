import { Injectable } from '@nestjs/common';
import { SearchType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';

@Injectable()
export class SearchService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async search(query: string, type: SearchType, userId: string, ipAddress?: string) {
    let vehicles: unknown[] = [];
    let owners: unknown[] = [];

    if (type === SearchType.PLATE || type === SearchType.VIN) {
      const normalized = query.toUpperCase().replace(/\s+/g, '');
      vehicles = await this.prisma.vehicle.findMany({
        where:
          type === SearchType.PLATE
            ? { plateNumber: { contains: normalized } }
            : { vin: { contains: normalized } },
        include: { ownerships: { where: { endDate: null }, include: { owner: true } } },
        take: 25,
      });
    } else {
      owners = await this.prisma.owner.findMany({
        where: {
          OR: [
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { nationalId: { contains: query, mode: 'insensitive' } },
            { licenseNumber: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: 25,
      });
    }

    const resultCount = vehicles.length + owners.length;

    // Traçabilité obligatoire de toute recherche effectuée par un agent (feature 23)
    await this.prisma.search.create({
      data: { userId, query, type, resultCount },
    });
    await this.audit.log({
      userId,
      action: 'SEARCH',
      entityType: type,
      metadata: { query, resultCount },
      ipAddress,
    });

    return { vehicles, owners };
  }

  searchHistory(userId?: string) {
    return this.prisma.search.findMany({
      where: userId ? { userId } : undefined,
      include: { user: { select: { firstName: true, lastName: true, badgeNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
