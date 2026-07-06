import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  DisputeStatus,
  InfractionStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateInfractionDto } from './dto/create-infraction.dto';

// Transitions autorisées du cycle de vie d'un PV
const TRANSITIONS: Partial<Record<InfractionStatus, InfractionStatus[]>> = {
  [InfractionStatus.DRAFT]: [InfractionStatus.PENDING_REVIEW, InfractionStatus.CANCELLED],
  [InfractionStatus.PENDING]: [
    InfractionStatus.VALIDATED,
    InfractionStatus.REJECTED,
    InfractionStatus.CANCELLED,
  ],
  [InfractionStatus.PENDING_REVIEW]: [
    InfractionStatus.VALIDATED,
    InfractionStatus.REJECTED,
    InfractionStatus.CANCELLED,
  ],
  [InfractionStatus.VALIDATED]: [InfractionStatus.NOTIFIED, InfractionStatus.CANCELLED],
  [InfractionStatus.NOTIFIED]: [
    InfractionStatus.PAID,
    InfractionStatus.CONTESTED,
    InfractionStatus.CANCELLED,
  ],
  [InfractionStatus.CONTESTED]: [
    InfractionStatus.NOTIFIED, // contestation rejetée -> redevient exigible
    InfractionStatus.CANCELLED, // contestation acceptée
  ],
  [InfractionStatus.PAID]: [InfractionStatus.CLOSED],
};

@Injectable()
export class InfractionsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  private async nextReference(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.infraction.count();
    return `PV-${year}-${String(count + 1).padStart(6, '0')}`;
  }

  private assertTransition(from: InfractionStatus, to: InfractionStatus) {
    if (!TRANSITIONS[from]?.includes(to)) {
      throw new BadRequestException(`Transition interdite : ${from} → ${to}`);
    }
  }

  async create(dto: CreateInfractionDto, officerId: string, asDraft = false) {
    let label = dto.type ?? 'Infraction';
    let fineAmount = dto.fineAmount;
    let points = dto.points;

    if (dto.typeId) {
      const type = await this.prisma.infractionType.findUnique({ where: { id: dto.typeId } });
      if (!type || !type.active) throw new BadRequestException('Type d’infraction invalide');
      label = dto.type || type.label;
      fineAmount = fineAmount ?? type.baseAmount;
      points = points ?? type.points;
    }

    const reference = await this.nextReference();
    const infraction = await this.prisma.infraction.create({
      data: {
        ...dto,
        type: label,
        fineAmount,
        amountDue: fineAmount,
        points,
        reference,
        officerId,
        status: asDraft ? InfractionStatus.DRAFT : InfractionStatus.PENDING_REVIEW,
      },
      include: { vehicle: true, owner: true, infractionType: true },
    });

    await this.audit.log({
      userId: officerId,
      action: 'INFRACTION_CREATED',
      entityType: 'Infraction',
      entityId: infraction.id,
      metadata: { reference, status: infraction.status },
    });
    return infraction;
  }

  findAll(params: { vehicleId?: string; ownerId?: string; status?: InfractionStatus } = {}) {
    return this.prisma.infraction.findMany({
      where: { vehicleId: params.vehicleId, ownerId: params.ownerId, status: params.status },
      include: {
        vehicle: true,
        owner: true,
        infractionType: true,
        officer: { select: { firstName: true, lastName: true } },
        payments: true,
        dispute: true,
      },
      orderBy: { occurredAt: 'desc' },
      take: 200,
    });
  }

  async findOne(id: string) {
    const infraction = await this.prisma.infraction.findUnique({
      where: { id },
      include: {
        vehicle: { include: { ownerships: { where: { endDate: null }, include: { owner: true } } } },
        owner: true,
        officer: true,
        capture: true,
        infractionType: true,
        validatedBy: { select: { firstName: true, lastName: true } },
        payments: { orderBy: { createdAt: 'desc' } },
        dispute: true,
        notifications: { orderBy: { sentAt: 'desc' } },
      },
    });
    if (!infraction) throw new NotFoundException('Infraction introuvable');
    return infraction;
  }

  // --- Workflow ---

  async submitForReview(id: string, userId: string) {
    const infraction = await this.findOne(id);
    this.assertTransition(infraction.status, InfractionStatus.PENDING_REVIEW);
    return this.transition(id, InfractionStatus.PENDING_REVIEW, userId);
  }

  async validate(id: string, supervisorId: string) {
    const infraction = await this.findOne(id);
    this.assertTransition(infraction.status, InfractionStatus.VALIDATED);
    const updated = await this.prisma.infraction.update({
      where: { id },
      data: {
        status: InfractionStatus.VALIDATED,
        validatedById: supervisorId,
        validatedAt: new Date(),
      },
    });
    await this.audit.log({
      userId: supervisorId,
      action: 'INFRACTION_VALIDATED',
      entityType: 'Infraction',
      entityId: id,
    });
    return updated;
  }

  async reject(id: string, supervisorId: string, reason: string) {
    const infraction = await this.findOne(id);
    this.assertTransition(infraction.status, InfractionStatus.REJECTED);
    const updated = await this.prisma.infraction.update({
      where: { id },
      data: { status: InfractionStatus.REJECTED, rejectionReason: reason },
    });
    await this.audit.log({
      userId: supervisorId,
      action: 'INFRACTION_REJECTED',
      entityType: 'Infraction',
      entityId: id,
      metadata: { reason },
    });
    return updated;
  }

  // Notification au propriétaire : calcule l'échéance, applique le montant
  // minoré si un barème est lié, journalise l'envoi (email simulé).
  async notify(id: string, userId: string) {
    const infraction = await this.findOne(id);
    this.assertTransition(infraction.status, InfractionStatus.NOTIFIED);

    const type = infraction.infractionType;
    const now = new Date();
    const dueDate = new Date(now.getTime() + (type?.dueDays ?? 45) * 86_400_000);
    const amountDue =
      type?.reducedAmount != null ? type.reducedAmount : infraction.fineAmount ?? 0;

    const owner =
      infraction.owner ?? infraction.vehicle.ownerships[0]?.owner ?? null;
    const recipient = owner
      ? `${owner.firstName} ${owner.lastName}`
      : `Propriétaire de ${infraction.vehicle.plateNumber}`;

    const updated = await this.prisma.infraction.update({
      where: { id },
      data: {
        status: InfractionStatus.NOTIFIED,
        notifiedAt: now,
        dueDate,
        amountDue,
        ownerId: infraction.ownerId ?? owner?.id,
      },
    });

    await this.notifications.sendInfractionNotice(updated.id, recipient, {
      reference: updated.reference ?? updated.id,
      plate: infraction.vehicle.plateNumber,
      label: infraction.type,
      amountDue,
      reducedUntil: type?.reducedDays
        ? new Date(now.getTime() + type.reducedDays * 86_400_000)
        : null,
      dueDate,
    });

    await this.audit.log({
      userId,
      action: 'INFRACTION_NOTIFIED',
      entityType: 'Infraction',
      entityId: id,
      metadata: { recipient, amountDue, dueDate },
    });
    return updated;
  }

  // --- Paiement ---

  async recordPayment(
    id: string,
    params: { method: PaymentMethod; payerName?: string; recordedById?: string },
  ) {
    const infraction = await this.findOne(id);
    if (
      infraction.status !== InfractionStatus.NOTIFIED &&
      infraction.status !== InfractionStatus.VALIDATED
    ) {
      throw new BadRequestException(
        `Le PV n'est pas exigible (statut ${infraction.status})`,
      );
    }
    const amount = infraction.amountDue ?? infraction.fineAmount ?? 0;
    const receiptNumber = `REC-${new Date().getFullYear()}-${String(
      (await this.prisma.payment.count()) + 1,
    ).padStart(6, '0')}`;

    const [payment] = await this.prisma.$transaction([
      this.prisma.payment.create({
        data: {
          infractionId: id,
          amount,
          method: params.method,
          status: PaymentStatus.COMPLETED,
          receiptNumber,
          payerName: params.payerName,
          recordedById: params.recordedById,
        },
      }),
      this.prisma.infraction.update({
        where: { id },
        data: { status: InfractionStatus.PAID, amountDue: 0 },
      }),
    ]);

    await this.audit.log({
      userId: params.recordedById,
      action: 'PAYMENT_RECORDED',
      entityType: 'Infraction',
      entityId: id,
      metadata: { amount, method: params.method, receiptNumber },
    });
    return payment;
  }

  // --- Contestation ---

  async openDispute(
    id: string,
    params: { reason: string; details?: string; contactEmail?: string; attachmentUrls?: string[] },
  ) {
    const infraction = await this.findOne(id);
    this.assertTransition(infraction.status, InfractionStatus.CONTESTED);
    if (infraction.dispute) throw new BadRequestException('Une contestation existe déjà');

    const [dispute] = await this.prisma.$transaction([
      this.prisma.dispute.create({
        data: {
          infractionId: id,
          reason: params.reason,
          details: params.details,
          contactEmail: params.contactEmail,
          attachmentUrls: params.attachmentUrls ?? [],
        },
      }),
      this.prisma.infraction.update({
        where: { id },
        data: { status: InfractionStatus.CONTESTED },
      }),
    ]);
    await this.audit.log({
      action: 'DISPUTE_OPENED',
      entityType: 'Infraction',
      entityId: id,
      metadata: { reason: params.reason },
    });
    return dispute;
  }

  async decideDispute(
    id: string,
    params: { accept: boolean; decision: string; decidedById: string },
  ) {
    const infraction = await this.findOne(id);
    if (!infraction.dispute) throw new NotFoundException('Aucune contestation sur ce PV');
    if (
      infraction.dispute.status !== DisputeStatus.PENDING &&
      infraction.dispute.status !== DisputeStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException('Contestation déjà tranchée');
    }

    const newInfractionStatus = params.accept
      ? InfractionStatus.CANCELLED
      : InfractionStatus.NOTIFIED;

    const [dispute] = await this.prisma.$transaction([
      this.prisma.dispute.update({
        where: { infractionId: id },
        data: {
          status: params.accept ? DisputeStatus.ACCEPTED : DisputeStatus.REJECTED,
          decision: params.decision,
          decidedById: params.decidedById,
          decidedAt: new Date(),
        },
      }),
      this.prisma.infraction.update({
        where: { id },
        data: { status: newInfractionStatus },
      }),
    ]);
    await this.audit.log({
      userId: params.decidedById,
      action: params.accept ? 'DISPUTE_ACCEPTED' : 'DISPUTE_REJECTED',
      entityType: 'Infraction',
      entityId: id,
      metadata: { decision: params.decision },
    });
    return dispute;
  }

  // --- Clôture / annulation ---

  async close(id: string, userId: string) {
    const infraction = await this.findOne(id);
    this.assertTransition(infraction.status, InfractionStatus.CLOSED);
    const updated = await this.prisma.infraction.update({
      where: { id },
      data: { status: InfractionStatus.CLOSED, closedAt: new Date() },
    });
    await this.audit.log({
      userId,
      action: 'INFRACTION_CLOSED',
      entityType: 'Infraction',
      entityId: id,
    });
    return updated;
  }

  async cancel(id: string, userId: string, reason?: string) {
    const infraction = await this.findOne(id);
    this.assertTransition(infraction.status, InfractionStatus.CANCELLED);
    const updated = await this.prisma.infraction.update({
      where: { id },
      data: { status: InfractionStatus.CANCELLED, rejectionReason: reason },
    });
    await this.audit.log({
      userId,
      action: 'INFRACTION_CANCELLED',
      entityType: 'Infraction',
      entityId: id,
      metadata: { reason },
    });
    return updated;
  }

  // --- Majoration automatique : tous les jours à 04h00 ---
  // Les PV notifiés non payés après échéance passent au montant majoré.
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async applyLateIncrease() {
    const overdue = await this.prisma.infraction.findMany({
      where: {
        status: InfractionStatus.NOTIFIED,
        dueDate: { lt: new Date() },
      },
      include: { infractionType: true },
    });

    let increased = 0;
    for (const infraction of overdue) {
      const increasedAmount =
        infraction.infractionType?.increasedAmount ??
        (infraction.fineAmount != null ? infraction.fineAmount * 1.5 : null);
      if (increasedAmount == null || infraction.amountDue === increasedAmount) continue;
      await this.prisma.infraction.update({
        where: { id: infraction.id },
        data: { amountDue: increasedAmount },
      });
      increased++;
    }
    if (increased > 0) {
      await this.audit.log({
        action: 'LATE_INCREASE_APPLIED',
        entityType: 'Infraction',
        metadata: { count: increased },
      });
    }
    return { increased };
  }

  private async transition(id: string, status: InfractionStatus, userId: string) {
    const updated = await this.prisma.infraction.update({ where: { id }, data: { status } });
    await this.audit.log({
      userId,
      action: `INFRACTION_${status}`,
      entityType: 'Infraction',
      entityId: id,
    });
    return updated;
  }
}
