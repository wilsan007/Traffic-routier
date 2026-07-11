import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DisputeStatus, InfractionStatus, PaymentMethod } from '@prisma/client';
import { InfractionsService } from './infractions.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('InfractionsService', () => {
  let service: InfractionsService;
  let prisma: any;
  let audit: { log: jest.Mock };
  let notifications: { sendInfractionNotice: jest.Mock };

  beforeEach(async () => {
    prisma = {
      infraction: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      infractionType: { findUnique: jest.fn() },
      payment: { count: jest.fn().mockResolvedValue(0), create: jest.fn() },
      dispute: { create: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    notifications = { sendInfractionNotice: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InfractionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<InfractionsService>(InfractionsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // --- State machine (assertTransition) ---

  describe('workflow transitions', () => {
    it('should allow submitForReview from DRAFT', async () => {
      prisma.infraction.findUnique.mockResolvedValue({ id: '1', status: InfractionStatus.DRAFT });
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.PENDING_REVIEW });

      const result = await service.submitForReview('1', 'u1');

      expect(result.status).toBe(InfractionStatus.PENDING_REVIEW);
      expect(prisma.infraction.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: InfractionStatus.PENDING_REVIEW },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'INFRACTION_PENDING_REVIEW' }),
      );
    });

    it('should reject submitForReview from a non-DRAFT status', async () => {
      prisma.infraction.findUnique.mockResolvedValue({ id: '1', status: InfractionStatus.VALIDATED });

      await expect(service.submitForReview('1', 'u1')).rejects.toThrow(BadRequestException);
      expect(prisma.infraction.update).not.toHaveBeenCalled();
    });

    it('should validate a PENDING_REVIEW infraction', async () => {
      prisma.infraction.findUnique.mockResolvedValue({ id: '1', status: InfractionStatus.PENDING_REVIEW });
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.VALIDATED });

      const result = await service.validate('1', 'supervisor-1');

      expect(result.status).toBe(InfractionStatus.VALIDATED);
      expect(prisma.infraction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: InfractionStatus.VALIDATED,
            validatedById: 'supervisor-1',
            validatedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should reject validate from an already-terminal status', async () => {
      prisma.infraction.findUnique.mockResolvedValue({ id: '1', status: InfractionStatus.PAID });
      await expect(service.validate('1', 'supervisor-1')).rejects.toThrow(BadRequestException);
    });

    it('should reject a PENDING_REVIEW infraction with a reason', async () => {
      prisma.infraction.findUnique.mockResolvedValue({ id: '1', status: InfractionStatus.PENDING_REVIEW });
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.REJECTED });

      const result = await service.reject('1', 'supervisor-1', 'Preuve insuffisante');

      expect(result.status).toBe(InfractionStatus.REJECTED);
      expect(prisma.infraction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: InfractionStatus.REJECTED, rejectionReason: 'Preuve insuffisante' },
        }),
      );
    });

    it('should close a PAID infraction', async () => {
      prisma.infraction.findUnique.mockResolvedValue({ id: '1', status: InfractionStatus.PAID });
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.CLOSED });

      const result = await service.close('1', 'u1');
      expect(result.status).toBe(InfractionStatus.CLOSED);
    });

    it('should reject closing a non-PAID infraction', async () => {
      prisma.infraction.findUnique.mockResolvedValue({ id: '1', status: InfractionStatus.NOTIFIED });
      await expect(service.close('1', 'u1')).rejects.toThrow(BadRequestException);
    });

    it('should cancel a DRAFT infraction', async () => {
      prisma.infraction.findUnique.mockResolvedValue({ id: '1', status: InfractionStatus.DRAFT });
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.CANCELLED });

      const result = await service.cancel('1', 'u1', 'Erreur de saisie');
      expect(result.status).toBe(InfractionStatus.CANCELLED);
    });

    it('should reject cancelling a CLOSED infraction', async () => {
      prisma.infraction.findUnique.mockResolvedValue({ id: '1', status: InfractionStatus.CLOSED });
      await expect(service.cancel('1', 'u1')).rejects.toThrow(BadRequestException);
    });
  });

  // --- notify() ---

  describe('notify', () => {
    it('should reject notify from a non-VALIDATED status', async () => {
      prisma.infraction.findUnique.mockResolvedValue({ id: '1', status: InfractionStatus.DRAFT });
      await expect(service.notify('1', 'u1')).rejects.toThrow(BadRequestException);
      expect(notifications.sendInfractionNotice).not.toHaveBeenCalled();
    });

    it('should notify using the owner directly attached to the infraction', async () => {
      prisma.infraction.findUnique.mockResolvedValue({
        id: '1',
        status: InfractionStatus.VALIDATED,
        reference: 'PV-2026-000001',
        fineAmount: 135,
        ownerId: 'owner-1',
        owner: { id: 'owner-1', firstName: 'Jean', lastName: 'Dupont' },
        vehicle: { plateNumber: 'AB123CD', ownerships: [] },
        infractionType: { dueDays: 30, reducedAmount: 90, reducedDays: 15 },
        type: 'Excès de vitesse',
      });
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.NOTIFIED });

      await service.notify('1', 'u1');

      expect(prisma.infraction.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: expect.objectContaining({
          status: InfractionStatus.NOTIFIED,
          amountDue: 90,
          ownerId: 'owner-1',
          dueDate: expect.any(Date),
        }),
      });
      expect(notifications.sendInfractionNotice).toHaveBeenCalledWith(
        '1',
        'Jean Dupont',
        expect.objectContaining({ amountDue: 90, plate: 'AB123CD' }),
      );
    });

    it('should fall back to the current owner of the vehicle when no owner is attached', async () => {
      prisma.infraction.findUnique.mockResolvedValue({
        id: '1',
        status: InfractionStatus.VALIDATED,
        reference: 'PV-2026-000002',
        fineAmount: 68,
        ownerId: null,
        owner: null,
        vehicle: {
          plateNumber: 'XY987ZT',
          ownerships: [{ owner: { id: 'owner-2', firstName: 'Marie', lastName: 'Curie' } }],
        },
        infractionType: null,
        type: 'Stationnement gênant',
      });
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.NOTIFIED });

      await service.notify('1', 'u1');

      expect(notifications.sendInfractionNotice).toHaveBeenCalledWith(
        '1',
        'Marie Curie',
        expect.objectContaining({ amountDue: 68 }),
      );
      expect(prisma.infraction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ ownerId: 'owner-2' }) }),
      );
    });

    it('should use a generic recipient when no owner can be found and default due days to 45', async () => {
      prisma.infraction.findUnique.mockResolvedValue({
        id: '1',
        status: InfractionStatus.VALIDATED,
        reference: 'PV-2026-000003',
        fineAmount: 35,
        ownerId: null,
        owner: null,
        vehicle: { plateNumber: 'ZZ111ZZ', ownerships: [] },
        infractionType: null,
        type: 'Stationnement gênant',
      });
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.NOTIFIED });

      const before = Date.now();
      await service.notify('1', 'u1');

      expect(notifications.sendInfractionNotice).toHaveBeenCalledWith(
        '1',
        'Propriétaire de ZZ111ZZ',
        expect.objectContaining({ amountDue: 35 }),
      );
      const [, , details] = notifications.sendInfractionNotice.mock.calls[0];
      const diffDays = (details.dueDate.getTime() - before) / 86_400_000;
      expect(diffDays).toBeGreaterThan(44.9);
      expect(diffDays).toBeLessThan(45.1);
    });
  });

  // --- recordPayment() ---

  describe('recordPayment', () => {
    it('should reject payment when the infraction is not exigible', async () => {
      prisma.infraction.findUnique.mockResolvedValue({ id: '1', status: InfractionStatus.DRAFT });
      await expect(
        service.recordPayment('1', { method: PaymentMethod.CASH }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should record a payment for a NOTIFIED infraction and mark it PAID', async () => {
      prisma.infraction.findUnique.mockResolvedValue({
        id: '1',
        status: InfractionStatus.NOTIFIED,
        amountDue: 90,
        fineAmount: 135,
      });
      prisma.payment.count.mockResolvedValue(4);
      const mockPayment = { id: 'pay-1', amount: 90, receiptNumber: expect.any(String) };
      prisma.payment.create.mockResolvedValue(mockPayment);
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.PAID });

      const result = await service.recordPayment('1', {
        method: PaymentMethod.CARD_ONLINE,
        payerName: 'Jean Dupont',
        recordedById: 'u1',
      });

      expect(result).toEqual(mockPayment);
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            infractionId: '1',
            amount: 90,
            method: PaymentMethod.CARD_ONLINE,
          }),
        }),
      );
      expect(prisma.infraction.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: InfractionStatus.PAID, amountDue: 0 },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'PAYMENT_RECORDED' }),
      );
    });

    it('should fall back to fineAmount when amountDue is not set', async () => {
      prisma.infraction.findUnique.mockResolvedValue({
        id: '1',
        status: InfractionStatus.VALIDATED,
        amountDue: null,
        fineAmount: 68,
      });
      prisma.payment.create.mockResolvedValue({ id: 'pay-2', amount: 68 });
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.PAID });

      await service.recordPayment('1', { method: PaymentMethod.CASH });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 68 }) }),
      );
    });
  });

  // --- Disputes ---

  describe('disputes', () => {
    it('should open a dispute on a NOTIFIED infraction', async () => {
      prisma.infraction.findUnique.mockResolvedValue({
        id: '1',
        status: InfractionStatus.NOTIFIED,
        dispute: null,
      });
      prisma.dispute.create.mockResolvedValue({ id: 'd1', infractionId: '1' });
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.CONTESTED });

      const result = await service.openDispute('1', { reason: 'Erreur de plaque' });

      expect(result).toEqual({ id: 'd1', infractionId: '1' });
      expect(prisma.infraction.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: InfractionStatus.CONTESTED },
      });
    });

    it('should reject opening a second dispute', async () => {
      prisma.infraction.findUnique.mockResolvedValue({
        id: '1',
        status: InfractionStatus.NOTIFIED,
        dispute: { id: 'existing' },
      });
      await expect(
        service.openDispute('1', { reason: 'Encore' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject opening a dispute from a non-eligible status', async () => {
      prisma.infraction.findUnique.mockResolvedValue({
        id: '1',
        status: InfractionStatus.DRAFT,
        dispute: null,
      });
      await expect(
        service.openDispute('1', { reason: 'Erreur' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should cancel the infraction when a dispute is accepted', async () => {
      prisma.infraction.findUnique.mockResolvedValue({
        id: '1',
        dispute: { status: DisputeStatus.PENDING },
      });
      prisma.dispute.update.mockResolvedValue({ id: 'd1', status: DisputeStatus.ACCEPTED });
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.CANCELLED });

      await service.decideDispute('1', { accept: true, decision: 'Preuve valable', decidedById: 'sup-1' });

      expect(prisma.infraction.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: InfractionStatus.CANCELLED },
      });
    });

    it('should revert the infraction to NOTIFIED when a dispute is rejected', async () => {
      prisma.infraction.findUnique.mockResolvedValue({
        id: '1',
        dispute: { status: DisputeStatus.UNDER_REVIEW },
      });
      prisma.dispute.update.mockResolvedValue({ id: 'd1', status: DisputeStatus.REJECTED });
      prisma.infraction.update.mockResolvedValue({ id: '1', status: InfractionStatus.NOTIFIED });

      await service.decideDispute('1', { accept: false, decision: 'Non fondée', decidedById: 'sup-1' });

      expect(prisma.infraction.update).toHaveBeenCalledWith({
        where: { id: '1' },
        data: { status: InfractionStatus.NOTIFIED },
      });
    });

    it('should throw if there is no dispute to decide', async () => {
      prisma.infraction.findUnique.mockResolvedValue({ id: '1', dispute: null });
      await expect(
        service.decideDispute('1', { accept: true, decision: 'x', decidedById: 'sup-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject deciding an already-decided dispute', async () => {
      prisma.infraction.findUnique.mockResolvedValue({
        id: '1',
        dispute: { status: DisputeStatus.ACCEPTED },
      });
      await expect(
        service.decideDispute('1', { accept: true, decision: 'x', decidedById: 'sup-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // --- applyLateIncrease() cron ---

  describe('applyLateIncrease', () => {
    it('should increase overdue amounts using the infraction type schedule when present', async () => {
      prisma.infraction.findMany.mockResolvedValue([
        { id: 'i1', amountDue: 90, fineAmount: 90, infractionType: { increasedAmount: 180 } },
      ]);
      prisma.infraction.update.mockResolvedValue({});

      const result = await service.applyLateIncrease();

      expect(result).toEqual({ increased: 1 });
      expect(prisma.infraction.update).toHaveBeenCalledWith({
        where: { id: 'i1' },
        data: { amountDue: 180 },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'LATE_INCREASE_APPLIED', metadata: { count: 1 } }),
      );
    });

    it('should fall back to 1.5x fineAmount when no infraction type schedule exists', async () => {
      prisma.infraction.findMany.mockResolvedValue([
        { id: 'i2', amountDue: 100, fineAmount: 100, infractionType: null },
      ]);
      prisma.infraction.update.mockResolvedValue({});

      const result = await service.applyLateIncrease();

      expect(result).toEqual({ increased: 1 });
      expect(prisma.infraction.update).toHaveBeenCalledWith({
        where: { id: 'i2' },
        data: { amountDue: 150 },
      });
    });

    it('should skip infractions already at the increased amount', async () => {
      prisma.infraction.findMany.mockResolvedValue([
        { id: 'i3', amountDue: 150, fineAmount: 100, infractionType: null },
      ]);

      const result = await service.applyLateIncrease();

      expect(result).toEqual({ increased: 0 });
      expect(prisma.infraction.update).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('should skip infractions with no fineAmount and no schedule', async () => {
      prisma.infraction.findMany.mockResolvedValue([
        { id: 'i4', amountDue: null, fineAmount: null, infractionType: null },
      ]);

      const result = await service.applyLateIncrease();

      expect(result).toEqual({ increased: 0 });
      expect(prisma.infraction.update).not.toHaveBeenCalled();
    });

    it('should not log audit when nothing was increased', async () => {
      prisma.infraction.findMany.mockResolvedValue([]);
      const result = await service.applyLateIncrease();
      expect(result).toEqual({ increased: 0 });
      expect(audit.log).not.toHaveBeenCalled();
    });
  });
});
