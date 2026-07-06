import { Injectable, Logger } from '@nestjs/common';
import { TollTxStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { haversineKm } from '../patterns/patterns.service';

@Injectable()
export class TollsService {
  private readonly logger = new Logger(TollsService.name);

  constructor(private prisma: PrismaService) {}

  // Appelé à chaque capture : si elle vient d'une caméra de péage (ou se
  // trouve dans le rayon d'une zone), génère la transaction de passage.
  async processCapture(capture: {
    id: string;
    cameraId: string | null;
    plateNumberNormalized: string;
    vehicleId: string | null;
    latitude: number | null;
    longitude: number | null;
  }) {
    if (!capture.plateNumberNormalized) return null;

    const zones = await this.prisma.tollZone.findMany({ where: { active: true } });
    const zone = zones.find((z) => {
      if (z.cameraId && z.cameraId === capture.cameraId) return true;
      if (
        z.latitude != null &&
        z.longitude != null &&
        capture.latitude != null &&
        capture.longitude != null
      ) {
        return (
          haversineKm(z.latitude, z.longitude, capture.latitude, capture.longitude) * 1000 <=
          z.radiusMeters
        );
      }
      return false;
    });
    if (!zone) return null;

    const tx = await this.prisma.tollTransaction.create({
      data: {
        zoneId: zone.id,
        captureId: capture.id,
        vehicleId: capture.vehicleId,
        plateNumber: capture.plateNumberNormalized,
        amount: zone.pricePerPassage,
      },
    });
    this.logger.log(
      `Passage péage ${zone.name} : ${capture.plateNumberNormalized} — ${zone.pricePerPassage.toFixed(2)} €`,
    );
    return tx;
  }

  createZone(data: {
    name: string;
    pricePerPassage: number;
    latitude?: number;
    longitude?: number;
    radiusMeters?: number;
    cameraId?: string;
  }) {
    return this.prisma.tollZone.create({ data });
  }

  listZones() {
    return this.prisma.tollZone.findMany({
      include: { camera: true, _count: { select: { transactions: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async deactivateZone(id: string) {
    return this.prisma.tollZone.update({ where: { id }, data: { active: false } });
  }

  listTransactions(params: { zoneId?: string; plate?: string; status?: TollTxStatus } = {}) {
    return this.prisma.tollTransaction.findMany({
      where: {
        zoneId: params.zoneId,
        plateNumber: params.plate?.toUpperCase().replace(/\s+/g, ''),
        status: params.status,
      },
      include: { zone: true, vehicle: { include: { fleet: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  // Facturation simple : marque les transactions PENDING d'une plaque/flotte
  // comme facturées et retourne le total.
  async invoice(params: { plate?: string; fleetId?: string }) {
    const where = {
      status: TollTxStatus.PENDING,
      ...(params.plate
        ? { plateNumber: params.plate.toUpperCase().replace(/\s+/g, '') }
        : {}),
      ...(params.fleetId ? { vehicle: { fleetId: params.fleetId } } : {}),
    };
    const transactions = await this.prisma.tollTransaction.findMany({ where });
    const total = transactions.reduce((sum, t) => sum + t.amount, 0);
    await this.prisma.tollTransaction.updateMany({
      where: { id: { in: transactions.map((t) => t.id) } },
      data: { status: TollTxStatus.INVOICED },
    });
    return { count: transactions.length, total };
  }
}
