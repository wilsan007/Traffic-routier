import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { HotlistReason, Priority } from '@prisma/client';
import { HotlistService } from './hotlist.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisCacheService } from '../redis/redis-cache.service';

describe('HotlistService', () => {
  let service: HotlistService;
  let prisma: any;
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock; delPattern: jest.Mock };

  beforeEach(async () => {
    prisma = {
      hotlistEntry: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
      delPattern: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HotlistService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisCacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<HotlistService>(HotlistService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should normalize the plate and invalidate caches', async () => {
      prisma.hotlistEntry.create.mockResolvedValue({ id: 'h1', plateNumber: 'AB123CD' });

      const result = await service.create(
        { plateNumber: 'ab 123 cd', reason: HotlistReason.STOLEN_VEHICLE, priority: Priority.HIGH } as any,
        'creator-1',
      );

      expect(prisma.hotlistEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ plateNumber: 'AB123CD', createdById: 'creator-1' }),
      });
      expect(result).toEqual({ id: 'h1', plateNumber: 'AB123CD' });
      expect(cache.delPattern).toHaveBeenCalledWith('hotlist:match:*');
      expect(cache.del).toHaveBeenCalledWith('hotlist:active');
    });
  });

  describe('findAll', () => {
    it('should return cached active entries without hitting the database', async () => {
      cache.get.mockResolvedValue([{ id: 'cached' }]);

      const result = await service.findAll(true);

      expect(result).toEqual([{ id: 'cached' }]);
      expect(prisma.hotlistEntry.findMany).not.toHaveBeenCalled();
    });

    it('should fetch and cache active entries on a cache miss', async () => {
      cache.get.mockResolvedValue(null);
      prisma.hotlistEntry.findMany.mockResolvedValue([{ id: 'h1', active: true }]);

      const result = await service.findAll(true);

      expect(prisma.hotlistEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { active: true } }),
      );
      expect(cache.set).toHaveBeenCalledWith('hotlist:active', [{ id: 'h1', active: true }], 60);
      expect(result).toEqual([{ id: 'h1', active: true }]);
    });

    it('should bypass the cache entirely when not filtering to active entries', async () => {
      prisma.hotlistEntry.findMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);

      const result = await service.findAll(false);

      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
      expect(prisma.hotlistEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined }),
      );
      expect(result).toHaveLength(2);
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException when the entry does not exist', async () => {
      prisma.hotlistEntry.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });

    it('should return the entry when found', async () => {
      prisma.hotlistEntry.findUnique.mockResolvedValue({ id: 'h1' });
      const result = await service.findOne('h1');
      expect(result).toEqual({ id: 'h1' });
    });
  });

  describe('deactivate', () => {
    it('should deactivate an existing entry and invalidate caches', async () => {
      prisma.hotlistEntry.findUnique.mockResolvedValue({ id: 'h1', active: true });
      prisma.hotlistEntry.update.mockResolvedValue({ id: 'h1', active: false });

      const result = await service.deactivate('h1');

      expect(prisma.hotlistEntry.update).toHaveBeenCalledWith({
        where: { id: 'h1' },
        data: { active: false },
      });
      expect(cache.delPattern).toHaveBeenCalledWith('hotlist:match:*');
      expect(cache.del).toHaveBeenCalledWith('hotlist:active');
      expect(result).toEqual({ id: 'h1', active: false });
    });

    it('should throw NotFoundException when deactivating an unknown entry', async () => {
      prisma.hotlistEntry.findUnique.mockResolvedValue(null);
      await expect(service.deactivate('nonexistent')).rejects.toThrow(NotFoundException);
      expect(prisma.hotlistEntry.update).not.toHaveBeenCalled();
    });
  });

  describe('matchPlate', () => {
    it('should return cached matches without querying the database', async () => {
      cache.get.mockResolvedValue([{ id: 'h1' }]);

      const result = await service.matchPlate('AB123CD');

      expect(result).toEqual([{ id: 'h1' }]);
      expect(prisma.hotlistEntry.findMany).not.toHaveBeenCalled();
    });

    it('should query active, non-expired entries for the plate on a cache miss and cache the result', async () => {
      cache.get.mockResolvedValue(null);
      prisma.hotlistEntry.findMany.mockResolvedValue([{ id: 'h1', plateNumber: 'AB123CD' }]);

      const result = await service.matchPlate('AB123CD');

      expect(prisma.hotlistEntry.findMany).toHaveBeenCalledWith({
        where: {
          plateNumber: 'AB123CD',
          active: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
        },
      });
      expect(cache.set).toHaveBeenCalledWith(
        'hotlist:match:AB123CD',
        [{ id: 'h1', plateNumber: 'AB123CD' }],
        30,
      );
      expect(result).toEqual([{ id: 'h1', plateNumber: 'AB123CD' }]);
    });

    it('should return an empty array when no active entry matches', async () => {
      cache.get.mockResolvedValue(null);
      prisma.hotlistEntry.findMany.mockResolvedValue([]);

      const result = await service.matchPlate('ZZ999ZZ');

      expect(result).toEqual([]);
    });
  });
});
