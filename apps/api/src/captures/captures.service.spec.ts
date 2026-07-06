import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CapturesService } from './captures.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MlClientService } from './ml-client.service';
import { HotlistService } from '../hotlist/hotlist.service';
import { AlertsService } from '../alerts/alerts.service';
import { AuditService } from '../common/audit/audit.service';
import { RedisCacheService } from '../redis/redis-cache.service';

describe('CapturesService', () => {
  let service: CapturesService;
  let prisma: any;
  let storage: { uploadCaptureImage: jest.Mock };
  let mlClient: { detectPlate: jest.Mock };
  let hotlistService: { matchPlate: jest.Mock };
  let alertsService: { createFromMatch: jest.Mock };
  let audit: { log: jest.Mock };
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock; delPattern: jest.Mock };

  beforeEach(async () => {
    prisma = {
      vehicle: { findUnique: jest.fn() },
      capture: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    };
    storage = { uploadCaptureImage: jest.fn().mockResolvedValue('http://minio/captures/1.jpg') };
    mlClient = { detectPlate: jest.fn() };
    hotlistService = { matchPlate: jest.fn() };
    alertsService = { createFromMatch: jest.fn() };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined), del: jest.fn().mockResolvedValue(undefined), delPattern: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapturesService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: MlClientService, useValue: mlClient },
        { provide: HotlistService, useValue: hotlistService },
        { provide: AlertsService, useValue: alertsService },
        { provide: AuditService, useValue: audit },
        { provide: RedisCacheService, useValue: cache },
      ],
    }).compile();

    service = module.get<CapturesService>(CapturesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should ingest a capture with plate detection and no hotlist match', async () => {
    mlClient.detectPlate.mockResolvedValue({ plateText: 'AB123CD', confidence: 0.95 });
    prisma.vehicle.findUnique.mockResolvedValue({ id: 'v1', plateNumber: 'AB123CD' });
    prisma.capture.create.mockResolvedValue({ id: 'c1', plateNumberNormalized: 'AB123CD' });
    hotlistService.matchPlate.mockResolvedValue([]);

    const result = await service.ingest({
      imageBuffer: Buffer.from('fake-image'),
      officerId: 'u1',
    });

    expect(result.capture.plateNumberNormalized).toBe('AB123CD');
    expect(result.vehicleMatch).toEqual({ id: 'v1', plateNumber: 'AB123CD' });
    expect(result.hotlistAlerts).toEqual([]);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CAPTURE_INGESTED' }),
    );
  });

  it('should ingest a capture and create alerts on hotlist match', async () => {
    mlClient.detectPlate.mockResolvedValue({ plateText: 'XY987ZT', confidence: 0.88 });
    prisma.vehicle.findUnique.mockResolvedValue({ id: 'v2', plateNumber: 'XY987ZT' });
    prisma.capture.create.mockResolvedValue({ id: 'c2', plateNumberNormalized: 'XY987ZT' });
    hotlistService.matchPlate.mockResolvedValue([{ id: 'h1' }]);
    alertsService.createFromMatch.mockResolvedValue({ id: 'a1' });

    const result = await service.ingest({
      imageBuffer: Buffer.from('fake-image'),
      officerId: 'u1',
    });

    expect(result.hotlistAlerts).toHaveLength(1);
    expect(alertsService.createFromMatch).toHaveBeenCalledWith('h1', 'c2');
  });

  it('should handle empty plate detection gracefully', async () => {
    mlClient.detectPlate.mockResolvedValue({ plateText: '', confidence: 0 });
    prisma.capture.create.mockResolvedValue({ id: 'c3', plateNumberNormalized: '' });

    const result = await service.ingest({
      imageBuffer: Buffer.from('fake-image'),
    });

    expect(result.capture.plateNumberNormalized).toBe('');
    expect(result.vehicleMatch).toBeNull();
    expect(result.hotlistAlerts).toEqual([]);
  });

  it('should throw NotFoundException for unknown capture', async () => {
    prisma.capture.findUnique.mockResolvedValue(null);
    await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('should verify a capture with corrected plate', async () => {
    prisma.capture.findUnique.mockResolvedValue({ id: 'c1' });
    prisma.vehicle.findUnique.mockResolvedValue({ id: 'v1', plateNumber: 'AB123CD' });
    prisma.capture.update.mockResolvedValue({ id: 'c1', verified: true });

    await service.verify('c1', 'ab 123 cd', 'u1');

    expect(prisma.capture.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          plateNumberNormalized: 'AB123CD',
          verified: true,
          verifiedById: 'u1',
        }),
      }),
    );
  });
});
