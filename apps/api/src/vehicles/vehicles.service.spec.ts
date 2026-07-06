import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { PrismaService } from '../prisma/prisma.service';

describe('VehiclesService', () => {
  let service: VehiclesService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      vehicle: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      vehicleOwnership: {
        updateMany: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehiclesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<VehiclesService>(VehiclesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a vehicle with normalized plate', async () => {
    prisma.vehicle.create.mockResolvedValue({ id: '1', plateNumber: 'AB123CD' });
    await service.create({
      plateNumber: 'ab 123 cd',
      regionId: 'region-1',
    } as any);
    expect(prisma.vehicle.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ plateNumber: 'AB123CD' }),
      }),
    );
  });

  it('should find by plate with normalization', async () => {
    prisma.vehicle.findUnique.mockResolvedValue({ id: '1', plateNumber: 'AB123CD' });
    await service.findByPlate('ab 123 cd');
    expect(prisma.vehicle.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { plateNumber: 'AB123CD' },
      }),
    );
  });

  it('should throw NotFoundException if vehicle not found', async () => {
    prisma.vehicle.findUnique.mockResolvedValue(null);
    await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('should transfer ownership atomically', async () => {
    prisma.vehicle.findUnique.mockResolvedValue({ id: '1' });
    prisma.vehicleOwnership.updateMany.mockResolvedValue({ count: 1 });
    prisma.vehicleOwnership.create.mockResolvedValue({ id: '2', ownerId: 'owner-2' });

    await service.transferOwnership('1', 'owner-2');

    expect(prisma.vehicleOwnership.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { vehicleId: '1', endDate: null },
        data: { endDate: expect.any(Date) },
      }),
    );
    expect(prisma.vehicleOwnership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { vehicleId: '1', ownerId: 'owner-2', startDate: expect.any(Date) },
      }),
    );
  });
});
