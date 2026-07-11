import { Test, TestingModule } from '@nestjs/testing';
import {
  HotlistReason,
  InfractionSeverity,
  InfractionStatus,
  Priority,
} from '@prisma/client';
import { PatternsService, haversineKm } from './patterns.service';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';

// Deux points distants d'environ 12.2 km (utilisés pour calculer des
// vitesses implicites déterministes à partir d'écarts de temps précis).
const PT_A = { latitude: 48.8566, longitude: 2.3522 };
const PT_B = { latitude: 48.9666, longitude: 2.3522 };
const DISTANCE_KM = haversineKm(PT_A.latitude, PT_A.longitude, PT_B.latitude, PT_B.longitude);

// Décalage temporel (ms) nécessaire pour obtenir la vitesse implicite donnée
// sur la distance PT_A -> PT_B.
function gapMsForSpeed(speedKmh: number): number {
  return (DISTANCE_KM / speedKmh) * 3_600_000;
}

const SYSTEM_USER = { id: 'admin-1', role: 'ADMIN', active: true };

describe('PatternsService', () => {
  let service: PatternsService;
  let prisma: any;
  let alertsService: { createFromMatch: jest.Mock };

  beforeEach(async () => {
    prisma = {
      capture: { findFirst: jest.fn(), count: jest.fn(), findMany: jest.fn() },
      hotlistEntry: { findFirst: jest.fn(), create: jest.fn() },
      user: { findFirst: jest.fn() },
      sensitiveZone: { findMany: jest.fn() },
      camera: { findUnique: jest.fn() },
      infraction: { count: jest.fn(), create: jest.fn() },
    };
    alertsService = { createFromMatch: jest.fn().mockResolvedValue({ id: 'alert-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatternsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AlertsService, useValue: alertsService },
      ],
    }).compile();

    service = module.get<PatternsService>(PatternsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- checkClonedPlate ---

  describe('checkClonedPlate', () => {
    const now = new Date('2026-07-11T12:00:00Z');

    it('should return null when the plate is empty', async () => {
      const result = await service.checkClonedPlate({
        id: 'c1',
        plateNumberNormalized: '',
        latitude: PT_B.latitude,
        longitude: PT_B.longitude,
        capturedAt: now,
      });
      expect(result).toBeNull();
      expect(prisma.capture.findFirst).not.toHaveBeenCalled();
    });

    it('should return null when the capture has no coordinates', async () => {
      const result = await service.checkClonedPlate({
        id: 'c1',
        plateNumberNormalized: 'AB123CD',
        latitude: null,
        longitude: null,
        capturedAt: now,
      });
      expect(result).toBeNull();
      expect(prisma.capture.findFirst).not.toHaveBeenCalled();
    });

    it('should return null when no earlier capture of the same plate exists', async () => {
      prisma.capture.findFirst.mockResolvedValue(null);
      const result = await service.checkClonedPlate({
        id: 'c1',
        plateNumberNormalized: 'AB123CD',
        latitude: PT_B.latitude,
        longitude: PT_B.longitude,
        capturedAt: now,
      });
      expect(result).toBeNull();
    });

    it('should return null when the implied speed is plausible', async () => {
      const previousAt = new Date(now.getTime() - gapMsForSpeed(80));
      prisma.capture.findFirst.mockResolvedValue({
        latitude: PT_A.latitude,
        longitude: PT_A.longitude,
        capturedAt: previousAt,
      });

      const result = await service.checkClonedPlate({
        id: 'c1',
        plateNumberNormalized: 'AB123CD',
        latitude: PT_B.latitude,
        longitude: PT_B.longitude,
        capturedAt: now,
      });
      expect(result).toBeNull();
      expect(prisma.hotlistEntry.findFirst).not.toHaveBeenCalled();
    });

    it('should reuse an existing active CLONED_PLATE entry when the implied speed is impossible', async () => {
      const previousAt = new Date(now.getTime() - gapMsForSpeed(400));
      prisma.capture.findFirst.mockResolvedValue({
        latitude: PT_A.latitude,
        longitude: PT_A.longitude,
        capturedAt: previousAt,
      });
      prisma.hotlistEntry.findFirst.mockResolvedValue({ id: 'existing-entry' });

      const result = await service.checkClonedPlate({
        id: 'c2',
        plateNumberNormalized: 'AB123CD',
        latitude: PT_B.latitude,
        longitude: PT_B.longitude,
        capturedAt: now,
      });

      expect(prisma.hotlistEntry.create).not.toHaveBeenCalled();
      expect(alertsService.createFromMatch).toHaveBeenCalledWith('existing-entry', 'c2');
      expect(result).toEqual({ id: 'alert-1' });
    });

    it('should create a new CLONED_PLATE entry and alert when none exists', async () => {
      const previousAt = new Date(now.getTime() - gapMsForSpeed(400));
      prisma.capture.findFirst.mockResolvedValue({
        latitude: PT_A.latitude,
        longitude: PT_A.longitude,
        capturedAt: previousAt,
      });
      prisma.hotlistEntry.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(SYSTEM_USER);
      prisma.hotlistEntry.create.mockResolvedValue({ id: 'new-entry' });

      const result = await service.checkClonedPlate({
        id: 'c2',
        plateNumberNormalized: 'AB123CD',
        latitude: PT_B.latitude,
        longitude: PT_B.longitude,
        capturedAt: now,
      });

      expect(prisma.hotlistEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            plateNumber: 'AB123CD',
            reason: HotlistReason.CLONED_PLATE,
            priority: Priority.HIGH,
            createdById: SYSTEM_USER.id,
          }),
        }),
      );
      expect(alertsService.createFromMatch).toHaveBeenCalledWith('new-entry', 'c2');
      expect(result).toEqual({ id: 'alert-1' });
    });

    it('should return null and skip entry creation when no admin user exists', async () => {
      const previousAt = new Date(now.getTime() - gapMsForSpeed(400));
      prisma.capture.findFirst.mockResolvedValue({
        latitude: PT_A.latitude,
        longitude: PT_A.longitude,
        capturedAt: previousAt,
      });
      prisma.hotlistEntry.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.checkClonedPlate({
        id: 'c2',
        plateNumberNormalized: 'AB123CD',
        latitude: PT_B.latitude,
        longitude: PT_B.longitude,
        capturedAt: now,
      });

      expect(result).toBeNull();
      expect(prisma.hotlistEntry.create).not.toHaveBeenCalled();
      expect(alertsService.createFromMatch).not.toHaveBeenCalled();
    });
  });

  // --- checkRepeatedPassage ---

  describe('checkRepeatedPassage', () => {
    const now = new Date('2026-07-11T12:00:00Z');

    it('should return null when the plate is empty', async () => {
      const result = await service.checkRepeatedPassage({
        id: 'c1',
        plateNumberNormalized: '',
        cameraId: 'cam-1',
        latitude: null,
        longitude: null,
        capturedAt: now,
      });
      expect(result).toBeNull();
      expect(prisma.capture.count).not.toHaveBeenCalled();
    });

    it('should return null when the same-camera count is below the threshold and no coordinates are set', async () => {
      prisma.capture.count.mockResolvedValue(1);
      const result = await service.checkRepeatedPassage({
        id: 'c1',
        plateNumberNormalized: 'AB123CD',
        cameraId: 'cam-1',
        latitude: null,
        longitude: null,
        capturedAt: now,
      });
      expect(result).toBeNull();
      expect(prisma.sensitiveZone.findMany).not.toHaveBeenCalled();
    });

    it('should create/reuse a REPEATED_PASSAGE alert once the same-camera threshold is reached', async () => {
      prisma.capture.count.mockResolvedValue(3);
      prisma.hotlistEntry.findFirst.mockResolvedValue({ id: 'existing-entry' });

      const result = await service.checkRepeatedPassage({
        id: 'c1',
        plateNumberNormalized: 'AB123CD',
        cameraId: 'cam-1',
        latitude: null,
        longitude: null,
        capturedAt: now,
      });

      expect(prisma.hotlistEntry.create).not.toHaveBeenCalled();
      expect(alertsService.createFromMatch).toHaveBeenCalledWith('existing-entry', 'c1');
      expect(result).toEqual({ id: 'alert-1' });
    });

    it('should fall back to sensitive-zone counting when the camera count is insufficient', async () => {
      prisma.capture.count.mockResolvedValue(0);
      prisma.sensitiveZone.findMany.mockResolvedValue([
        { id: 'z1', name: 'Zone Test', latitude: PT_A.latitude, longitude: PT_A.longitude, radiusMeters: 1000 },
      ]);
      prisma.capture.findMany.mockResolvedValue([
        { latitude: PT_A.latitude, longitude: PT_A.longitude },
        { latitude: PT_A.latitude, longitude: PT_A.longitude },
        { latitude: PT_A.latitude, longitude: PT_A.longitude },
        { latitude: 0, longitude: 0 }, // hors zone, ne doit pas compter
      ]);
      prisma.hotlistEntry.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(SYSTEM_USER);
      prisma.hotlistEntry.create.mockResolvedValue({ id: 'new-entry' });

      const result = await service.checkRepeatedPassage({
        id: 'c1',
        plateNumberNormalized: 'AB123CD',
        cameraId: null,
        latitude: PT_A.latitude,
        longitude: PT_A.longitude,
        capturedAt: now,
      });

      expect(prisma.hotlistEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reason: HotlistReason.REPEATED_PASSAGE, priority: Priority.MEDIUM }),
        }),
      );
      expect(alertsService.createFromMatch).toHaveBeenCalledWith('new-entry', 'c1');
      expect(result).toEqual({ id: 'alert-1' });
    });

    it('should return null when the sensitive-zone recount stays below the threshold', async () => {
      prisma.capture.count.mockResolvedValue(0);
      prisma.sensitiveZone.findMany.mockResolvedValue([
        { id: 'z1', name: 'Zone Test', latitude: PT_A.latitude, longitude: PT_A.longitude, radiusMeters: 1000 },
      ]);
      prisma.capture.findMany.mockResolvedValue([
        { latitude: PT_A.latitude, longitude: PT_A.longitude },
      ]);

      const result = await service.checkRepeatedPassage({
        id: 'c1',
        plateNumberNormalized: 'AB123CD',
        cameraId: null,
        latitude: PT_A.latitude,
        longitude: PT_A.longitude,
        capturedAt: now,
      });

      expect(result).toBeNull();
      expect(prisma.hotlistEntry.create).not.toHaveBeenCalled();
    });

    it('should return null and skip entry creation when no admin user exists', async () => {
      prisma.capture.count.mockResolvedValue(3);
      prisma.hotlistEntry.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.checkRepeatedPassage({
        id: 'c1',
        plateNumberNormalized: 'AB123CD',
        cameraId: 'cam-1',
        latitude: null,
        longitude: null,
        capturedAt: now,
      });

      expect(result).toBeNull();
      expect(prisma.hotlistEntry.create).not.toHaveBeenCalled();
      expect(alertsService.createFromMatch).not.toHaveBeenCalled();
    });
  });

  // --- checkSpeedViolation ---

  describe('checkSpeedViolation', () => {
    const now = new Date('2026-07-11T12:00:00Z');

    function baseCapture(overrides: Partial<Parameters<PatternsService['checkSpeedViolation']>[0]> = {}) {
      return {
        id: 'c-current',
        plateNumberNormalized: 'AB123CD',
        cameraId: 'cam-b',
        capturedAt: now,
        vehicleId: null,
        ...overrides,
      };
    }

    it('should return null when the plate or camera is missing', async () => {
      expect(
        await service.checkSpeedViolation(baseCapture({ plateNumberNormalized: '' })),
      ).toBeNull();
      expect(
        await service.checkSpeedViolation(baseCapture({ cameraId: null })),
      ).toBeNull();
      expect(prisma.camera.findUnique).not.toHaveBeenCalled();
    });

    it('should return null when the current camera has no coordinates', async () => {
      prisma.camera.findUnique.mockResolvedValue({ latitude: null, longitude: null, maxSpeedKmh: 130, name: 'Cam B' });
      const result = await service.checkSpeedViolation(baseCapture());
      expect(result).toBeNull();
      expect(prisma.capture.findFirst).not.toHaveBeenCalled();
    });

    it('should return null when there is no earlier capture on another camera', async () => {
      prisma.camera.findUnique.mockResolvedValue({ latitude: PT_B.latitude, longitude: PT_B.longitude, maxSpeedKmh: 130, name: 'Cam B' });
      prisma.capture.findFirst.mockResolvedValue(null);
      const result = await service.checkSpeedViolation(baseCapture());
      expect(result).toBeNull();
    });

    it('should return null when the previous camera has no coordinates', async () => {
      prisma.camera.findUnique.mockResolvedValue({ latitude: PT_B.latitude, longitude: PT_B.longitude, maxSpeedKmh: 130, name: 'Cam B' });
      prisma.capture.findFirst.mockResolvedValue({
        capturedAt: new Date(now.getTime() - 600_000),
        camera: { latitude: null, longitude: null, maxSpeedKmh: 130, name: 'Cam A' },
      });
      const result = await service.checkSpeedViolation(baseCapture());
      expect(result).toBeNull();
    });

    it('should return null when the two cameras are too close to be reliable', async () => {
      prisma.camera.findUnique.mockResolvedValue({ latitude: PT_A.latitude, longitude: PT_A.longitude, maxSpeedKmh: 130, name: 'Cam B' });
      prisma.capture.findFirst.mockResolvedValue({
        capturedAt: new Date(now.getTime() - 600_000),
        camera: { latitude: PT_A.latitude, longitude: PT_A.longitude + 0.00001, maxSpeedKmh: 130, name: 'Cam A' },
      });
      const result = await service.checkSpeedViolation(baseCapture());
      expect(result).toBeNull();
    });

    it('should return null when the implied speed does not exceed the limit', async () => {
      prisma.camera.findUnique.mockResolvedValue({ latitude: PT_B.latitude, longitude: PT_B.longitude, maxSpeedKmh: 130, name: 'Cam B' });
      const previousAt = new Date(now.getTime() - gapMsForSpeed(80));
      prisma.capture.findFirst.mockResolvedValue({
        capturedAt: previousAt,
        camera: { latitude: PT_A.latitude, longitude: PT_A.longitude, maxSpeedKmh: 130, name: 'Cam A' },
      });

      const result = await service.checkSpeedViolation(baseCapture());
      expect(result).toBeNull();
      expect(prisma.hotlistEntry.findFirst).not.toHaveBeenCalled();
    });

    it('should create an alert but no infraction when the vehicle is unidentified', async () => {
      prisma.camera.findUnique.mockResolvedValue({ latitude: PT_B.latitude, longitude: PT_B.longitude, maxSpeedKmh: 100, name: 'Cam B' });
      const previousAt = new Date(now.getTime() - gapMsForSpeed(130));
      prisma.capture.findFirst.mockResolvedValue({
        capturedAt: previousAt,
        camera: { latitude: PT_A.latitude, longitude: PT_A.longitude, maxSpeedKmh: 100, name: 'Cam A' },
      });
      prisma.hotlistEntry.findFirst.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(SYSTEM_USER);
      prisma.hotlistEntry.create.mockResolvedValue({ id: 'speed-entry' });

      const result = await service.checkSpeedViolation(baseCapture({ vehicleId: null }));

      expect(prisma.hotlistEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reason: HotlistReason.SPEED_VIOLATION, priority: Priority.HIGH }),
        }),
      );
      expect(alertsService.createFromMatch).toHaveBeenCalledWith('speed-entry', 'c-current');
      expect(prisma.infraction.create).not.toHaveBeenCalled();
      expect(result).toEqual({ alert: { id: 'alert-1' }, infraction: null });
    });

    it('should auto-generate a MAJOR infraction for a moderate overshoot (20-50%)', async () => {
      prisma.camera.findUnique.mockResolvedValue({ latitude: PT_B.latitude, longitude: PT_B.longitude, maxSpeedKmh: 100, name: 'Cam B' });
      const previousAt = new Date(now.getTime() - gapMsForSpeed(130)); // +30% overshoot
      prisma.capture.findFirst.mockResolvedValue({
        capturedAt: previousAt,
        camera: { latitude: PT_A.latitude, longitude: PT_A.longitude, maxSpeedKmh: 100, name: 'Cam A' },
      });
      prisma.hotlistEntry.findFirst.mockResolvedValue({ id: 'existing-speed-entry' });
      prisma.user.findFirst.mockResolvedValue(SYSTEM_USER);
      prisma.infraction.count.mockResolvedValue(9);
      prisma.infraction.create.mockResolvedValue({ id: 'inf-1', reference: 'PV-2026-000010' });

      const result = await service.checkSpeedViolation(baseCapture({ vehicleId: 'veh-1' }));

      expect(prisma.infraction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            vehicleId: 'veh-1',
            fineAmount: 135,
            amountDue: 135,
            points: 2,
            severity: InfractionSeverity.MAJOR,
            status: InfractionStatus.PENDING_REVIEW,
          }),
        }),
      );
      expect(result).toEqual({ alert: { id: 'alert-1' }, infraction: { id: 'inf-1', reference: 'PV-2026-000010' } });
    });

    it('should auto-generate a CRITICAL infraction for a severe overshoot (>50%)', async () => {
      prisma.camera.findUnique.mockResolvedValue({ latitude: PT_B.latitude, longitude: PT_B.longitude, maxSpeedKmh: 100, name: 'Cam B' });
      const previousAt = new Date(now.getTime() - gapMsForSpeed(200)); // +100% overshoot
      prisma.capture.findFirst.mockResolvedValue({
        capturedAt: previousAt,
        camera: { latitude: PT_A.latitude, longitude: PT_A.longitude, maxSpeedKmh: 100, name: 'Cam A' },
      });
      prisma.hotlistEntry.findFirst.mockResolvedValue({ id: 'existing-speed-entry' });
      prisma.user.findFirst.mockResolvedValue(SYSTEM_USER);
      prisma.infraction.count.mockResolvedValue(0);
      prisma.infraction.create.mockResolvedValue({ id: 'inf-2', reference: 'PV-2026-000001' });

      const result = await service.checkSpeedViolation(baseCapture({ vehicleId: 'veh-2' }));

      expect(prisma.infraction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fineAmount: 300,
            amountDue: 300,
            points: 6,
            severity: InfractionSeverity.CRITICAL,
          }),
        }),
      );
      expect((result as any).infraction).toEqual({ id: 'inf-2', reference: 'PV-2026-000001' });
    });

    it('should auto-generate a minor-tier infraction for a small overshoot (<=20%)', async () => {
      prisma.camera.findUnique.mockResolvedValue({ latitude: PT_B.latitude, longitude: PT_B.longitude, maxSpeedKmh: 100, name: 'Cam B' });
      const previousAt = new Date(now.getTime() - gapMsForSpeed(115)); // +15% overshoot
      prisma.capture.findFirst.mockResolvedValue({
        capturedAt: previousAt,
        camera: { latitude: PT_A.latitude, longitude: PT_A.longitude, maxSpeedKmh: 100, name: 'Cam A' },
      });
      prisma.hotlistEntry.findFirst.mockResolvedValue({ id: 'existing-speed-entry' });
      prisma.user.findFirst.mockResolvedValue(SYSTEM_USER);
      prisma.infraction.count.mockResolvedValue(0);
      prisma.infraction.create.mockResolvedValue({ id: 'inf-3', reference: 'PV-2026-000001' });

      const result = await service.checkSpeedViolation(baseCapture({ vehicleId: 'veh-3' }));

      expect(prisma.infraction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fineAmount: 68,
            amountDue: 68,
            points: 1,
            severity: InfractionSeverity.MAJOR,
          }),
        }),
      );
      expect((result as any).infraction).toEqual({ id: 'inf-3', reference: 'PV-2026-000001' });
    });

    it('should leave infraction null when the vehicle is identified but no admin user exists', async () => {
      prisma.camera.findUnique.mockResolvedValue({ latitude: PT_B.latitude, longitude: PT_B.longitude, maxSpeedKmh: 100, name: 'Cam B' });
      const previousAt = new Date(now.getTime() - gapMsForSpeed(130));
      prisma.capture.findFirst.mockResolvedValue({
        capturedAt: previousAt,
        camera: { latitude: PT_A.latitude, longitude: PT_A.longitude, maxSpeedKmh: 100, name: 'Cam A' },
      });
      prisma.hotlistEntry.findFirst.mockResolvedValue({ id: 'existing-speed-entry' });
      prisma.user.findFirst.mockResolvedValue(null);

      const result = await service.checkSpeedViolation(baseCapture({ vehicleId: 'veh-4' }));

      expect(prisma.infraction.create).not.toHaveBeenCalled();
      expect(result).toEqual({ alert: { id: 'alert-1' }, infraction: null });
    });
  });
});
