import { Test, TestingModule } from '@nestjs/testing';
import { TollTxStatus } from '@prisma/client';
import { TollsService } from './tolls.service';
import { PrismaService } from '../prisma/prisma.service';

describe('TollsService', () => {
  let service: TollsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      tollZone: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
      tollTransaction: {
        create: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TollsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<TollsService>(TollsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processCapture', () => {
    it('should return null when the plate is empty', async () => {
      const result = await service.processCapture({
        id: 'c1',
        cameraId: 'cam-1',
        plateNumberNormalized: '',
        vehicleId: null,
        latitude: null,
        longitude: null,
      });
      expect(result).toBeNull();
      expect(prisma.tollZone.findMany).not.toHaveBeenCalled();
    });

    it('should create a transaction when the capture camera matches a toll zone camera', async () => {
      prisma.tollZone.findMany.mockResolvedValue([
        { id: 'z1', name: 'Péage A', cameraId: 'cam-1', latitude: null, longitude: null, radiusMeters: 0, pricePerPassage: 2.5 },
      ]);
      prisma.tollTransaction.create.mockResolvedValue({ id: 'tx1' });

      const result = await service.processCapture({
        id: 'c1',
        cameraId: 'cam-1',
        plateNumberNormalized: 'AB123CD',
        vehicleId: 'veh-1',
        latitude: null,
        longitude: null,
      });

      expect(prisma.tollTransaction.create).toHaveBeenCalledWith({
        data: {
          zoneId: 'z1',
          captureId: 'c1',
          vehicleId: 'veh-1',
          plateNumber: 'AB123CD',
          amount: 2.5,
        },
      });
      expect(result).toEqual({ id: 'tx1' });
    });

    it('should create a transaction when the capture falls within a geofenced toll zone', async () => {
      prisma.tollZone.findMany.mockResolvedValue([
        {
          id: 'z2',
          name: 'Péage B',
          cameraId: null,
          latitude: 48.8566,
          longitude: 2.3522,
          radiusMeters: 500,
          pricePerPassage: 1.8,
        },
      ]);
      prisma.tollTransaction.create.mockResolvedValue({ id: 'tx2' });

      const result = await service.processCapture({
        id: 'c2',
        cameraId: null,
        plateNumberNormalized: 'XY987ZT',
        vehicleId: null,
        latitude: 48.8566,
        longitude: 2.3522,
      });

      expect(prisma.tollTransaction.create).toHaveBeenCalledWith({
        data: {
          zoneId: 'z2',
          captureId: 'c2',
          vehicleId: null,
          plateNumber: 'XY987ZT',
          amount: 1.8,
        },
      });
      expect(result).toEqual({ id: 'tx2' });
    });

    it('should return null when neither the camera nor the coordinates match any active zone', async () => {
      prisma.tollZone.findMany.mockResolvedValue([
        { id: 'z1', cameraId: 'cam-other', latitude: 40, longitude: 3, radiusMeters: 100, pricePerPassage: 2 },
      ]);

      const result = await service.processCapture({
        id: 'c3',
        cameraId: 'cam-1',
        plateNumberNormalized: 'AB123CD',
        vehicleId: null,
        latitude: 48.8566,
        longitude: 2.3522,
      });

      expect(result).toBeNull();
      expect(prisma.tollTransaction.create).not.toHaveBeenCalled();
    });

    it('should return null when there are no active toll zones', async () => {
      prisma.tollZone.findMany.mockResolvedValue([]);
      const result = await service.processCapture({
        id: 'c4',
        cameraId: 'cam-1',
        plateNumberNormalized: 'AB123CD',
        vehicleId: null,
        latitude: null,
        longitude: null,
      });
      expect(result).toBeNull();
    });
  });

  describe('invoice', () => {
    it('should invoice all pending transactions for a plate and return the total', async () => {
      prisma.tollTransaction.findMany.mockResolvedValue([
        { id: 't1', amount: 2.5 },
        { id: 't2', amount: 1.8 },
      ]);
      prisma.tollTransaction.updateMany.mockResolvedValue({ count: 2 });

      const result = await service.invoice({ plate: 'ab 123 cd' });

      expect(prisma.tollTransaction.findMany).toHaveBeenCalledWith({
        where: { status: TollTxStatus.PENDING, plateNumber: 'AB123CD' },
      });
      expect(prisma.tollTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['t1', 't2'] } },
        data: { status: TollTxStatus.INVOICED },
      });
      expect(result).toEqual({ count: 2, total: 4.3 });
    });

    it('should invoice by fleet when no plate is given', async () => {
      prisma.tollTransaction.findMany.mockResolvedValue([{ id: 't3', amount: 5 }]);
      prisma.tollTransaction.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.invoice({ fleetId: 'fleet-1' });

      expect(prisma.tollTransaction.findMany).toHaveBeenCalledWith({
        where: { status: TollTxStatus.PENDING, vehicle: { fleetId: 'fleet-1' } },
      });
      expect(result).toEqual({ count: 1, total: 5 });
    });

    it('should return a zero total when there is nothing pending', async () => {
      prisma.tollTransaction.findMany.mockResolvedValue([]);
      prisma.tollTransaction.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.invoice({ plate: 'ZZ999ZZ' });

      expect(result).toEqual({ count: 0, total: 0 });
      expect(prisma.tollTransaction.updateMany).toHaveBeenCalledWith({
        where: { id: { in: [] } },
        data: { status: TollTxStatus.INVOICED },
      });
    });
  });

  describe('deactivateZone', () => {
    it('should mark a zone inactive', async () => {
      prisma.tollZone.update.mockResolvedValue({ id: 'z1', active: false });
      const result = await service.deactivateZone('z1');
      expect(prisma.tollZone.update).toHaveBeenCalledWith({
        where: { id: 'z1' },
        data: { active: false },
      });
      expect(result).toEqual({ id: 'z1', active: false });
    });
  });
});
