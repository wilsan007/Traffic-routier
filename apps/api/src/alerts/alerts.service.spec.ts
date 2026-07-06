import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsGateway } from './alerts.gateway';

describe('AlertsService', () => {
  let service: AlertsService;
  let prisma: any;
  let gateway: { emitNewAlert: jest.Mock; emitAlertUpdate: jest.Mock };

  beforeEach(async () => {
    prisma = {
      alert: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    gateway = {
      emitNewAlert: jest.fn(),
      emitAlertUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AlertsGateway, useValue: gateway },
      ],
    }).compile();

    service = module.get<AlertsService>(AlertsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create alert from match and emit via WebSocket', async () => {
    const mockAlert = { id: '1', status: 'NEW', hotlistEntry: {}, capture: {} };
    prisma.alert.create.mockResolvedValue(mockAlert);

    const result = await service.createFromMatch('hotlist-1', 'capture-1');

    expect(result).toEqual(mockAlert);
    expect(prisma.alert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { hotlistEntryId: 'hotlist-1', captureId: 'capture-1', status: 'NEW' },
      }),
    );
    expect(gateway.emitNewAlert).toHaveBeenCalledWith(mockAlert);
  });

  it('should throw NotFoundException if alert not found', async () => {
    prisma.alert.findUnique.mockResolvedValue(null);
    await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('should acknowledge alert and emit update', async () => {
    prisma.alert.findUnique.mockResolvedValue({ id: '1' });
    const mockUpdated = { id: '1', status: 'ACKNOWLEDGED' };
    prisma.alert.update.mockResolvedValue(mockUpdated);

    const result = await service.acknowledge('1', 'user-1');

    expect(result).toEqual(mockUpdated);
    expect(prisma.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'ACKNOWLEDGED', acknowledgedById: 'user-1' },
      }),
    );
    expect(gateway.emitAlertUpdate).toHaveBeenCalledWith(mockUpdated);
  });

  it('should resolve alert with given status', async () => {
    prisma.alert.findUnique.mockResolvedValue({ id: '1' });
    const mockResolved = { id: '1', status: 'RESOLVED' };
    prisma.alert.update.mockResolvedValue(mockResolved);

    const result = await service.resolve('1', 'RESOLVED');

    expect(result).toEqual(mockResolved);
    expect(prisma.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: 'RESOLVED', resolvedAt: expect.any(Date) },
      }),
    );
  });
});
