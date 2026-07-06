import { Injectable, NotFoundException } from '@nestjs/common';
import { AlertStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsGateway } from './alerts.gateway';

@Injectable()
export class AlertsService {
  constructor(
    private prisma: PrismaService,
    private gateway: AlertsGateway,
  ) {}

  async createFromMatch(hotlistEntryId: string, captureId: string) {
    const alert = await this.prisma.alert.create({
      data: { hotlistEntryId, captureId, status: AlertStatus.NEW },
      include: { hotlistEntry: true, capture: true },
    });
    this.gateway.emitNewAlert(alert);
    return alert;
  }

  findAll(status?: AlertStatus) {
    return this.prisma.alert.findMany({
      where: status ? { status } : undefined,
      include: { hotlistEntry: true, capture: { include: { vehicle: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string) {
    const alert = await this.prisma.alert.findUnique({
      where: { id },
      include: { hotlistEntry: true, capture: { include: { vehicle: true } } },
    });
    if (!alert) throw new NotFoundException('Alerte introuvable');
    return alert;
  }

  async acknowledge(id: string, userId: string) {
    await this.findOne(id);
    const alert = await this.prisma.alert.update({
      where: { id },
      data: { status: AlertStatus.ACKNOWLEDGED, acknowledgedById: userId },
      include: { hotlistEntry: true, capture: true },
    });
    this.gateway.emitAlertUpdate(alert);
    return alert;
  }

  async resolve(id: string, status: typeof AlertStatus.RESOLVED | typeof AlertStatus.FALSE_POSITIVE) {
    await this.findOne(id);
    const alert = await this.prisma.alert.update({
      where: { id },
      data: { status, resolvedAt: new Date() },
      include: { hotlistEntry: true, capture: true },
    });
    this.gateway.emitAlertUpdate(alert);
    return alert;
  }
}
