import { Test, TestingModule } from '@nestjs/testing';
import { SearchType } from '@prisma/client';
import { SearchService } from './search.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';

describe('SearchService', () => {
  let service: SearchService;
  let prisma: any;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      vehicle: { findMany: jest.fn() },
      owner: { findMany: jest.fn() },
      search: { create: jest.fn().mockResolvedValue(undefined), findMany: jest.fn() },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should search vehicles by normalized plate', async () => {
    prisma.vehicle.findMany.mockResolvedValue([{ id: 'v1', plateNumber: 'AB123CD' }]);

    const result = await service.search('ab 123 cd', SearchType.PLATE, 'u1', '10.0.0.1');

    expect(prisma.vehicle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { plateNumber: { contains: 'AB123CD' } },
      }),
    );
    expect(result).toEqual({ vehicles: [{ id: 'v1', plateNumber: 'AB123CD' }], owners: [] });
  });

  it('should search vehicles by normalized VIN', async () => {
    prisma.vehicle.findMany.mockResolvedValue([{ id: 'v2', vin: 'VF1AB12345' }]);

    await service.search('vf1 ab1 2345', SearchType.VIN, 'u1');

    expect(prisma.vehicle.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { vin: { contains: 'VF1AB12345' } },
      }),
    );
  });

  it('should search owners by name/id without normalizing the query', async () => {
    prisma.owner.findMany.mockResolvedValue([{ id: 'o1', firstName: 'Jean', lastName: 'Dupont' }]);

    const result = await service.search('Dupont', SearchType.OWNER, 'u1');

    expect(prisma.owner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { firstName: { contains: 'Dupont', mode: 'insensitive' } },
            { lastName: { contains: 'Dupont', mode: 'insensitive' } },
            { nationalId: { contains: 'Dupont', mode: 'insensitive' } },
            { licenseNumber: { contains: 'Dupont', mode: 'insensitive' } },
          ],
        },
      }),
    );
    expect(result.vehicles).toEqual([]);
    expect(result.owners).toHaveLength(1);
  });

  it('should record the search and audit log with the correct result count', async () => {
    prisma.vehicle.findMany.mockResolvedValue([{ id: 'v1' }, { id: 'v2' }]);

    await service.search('AB123CD', SearchType.PLATE, 'u1', '10.0.0.1');

    expect(prisma.search.create).toHaveBeenCalledWith({
      data: { userId: 'u1', query: 'AB123CD', type: SearchType.PLATE, resultCount: 2 },
    });
    expect(audit.log).toHaveBeenCalledWith({
      userId: 'u1',
      action: 'SEARCH',
      entityType: SearchType.PLATE,
      metadata: { query: 'AB123CD', resultCount: 2 },
      ipAddress: '10.0.0.1',
    });
  });

  it('should return an empty result set and still log a zero-count search', async () => {
    prisma.vehicle.findMany.mockResolvedValue([]);

    const result = await service.search('UNKNOWN', SearchType.PLATE, 'u1');

    expect(result).toEqual({ vehicles: [], owners: [] });
    expect(prisma.search.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ resultCount: 0 }) }),
    );
  });

  it('should list search history filtered by user', async () => {
    prisma.search.findMany.mockResolvedValue([{ id: 's1', userId: 'u1' }]);

    const result = await service.searchHistory('u1');

    expect(prisma.search.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    );
    expect(result).toEqual([{ id: 's1', userId: 'u1' }]);
  });

  it('should list all search history when no user is given', async () => {
    prisma.search.findMany.mockResolvedValue([]);

    await service.searchHistory();

    expect(prisma.search.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });
});
