import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { haversineKm } from '../patterns/patterns.service';

@Injectable()
export class VehiclesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateVehicleDto) {
    const { ownerId, ...vehicleData } = dto;
    return this.prisma.vehicle.create({
      data: {
        ...vehicleData,
        plateNumber: dto.plateNumber.toUpperCase().replace(/\s+/g, ''),
        ownerships: ownerId
          ? { create: { ownerId, startDate: new Date() } }
          : undefined,
      },
      include: { ownerships: { include: { owner: true } } },
    });
  }

  findAll(search?: string) {
    if (!search) {
      return this.prisma.vehicle.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
    }
    return this.prisma.vehicle.findMany({
      where: {
        OR: [
          { plateNumber: { contains: search.toUpperCase().replace(/\s+/g, ''), mode: 'insensitive' } },
          { vin: { contains: search, mode: 'insensitive' } },
        ],
      },
      take: 50,
    });
  }

  async findOne(id: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id },
      include: {
        region: true,
        ownerships: { include: { owner: true }, orderBy: { startDate: 'desc' } },
        infractions: { orderBy: { occurredAt: 'desc' } },
        captures: { orderBy: { capturedAt: 'desc' }, take: 20 },
        cases: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!vehicle) throw new NotFoundException('Véhicule introuvable');
    return vehicle;
  }

  async findByPlate(plate: string) {
    const normalized = plate.toUpperCase().replace(/\s+/g, '');
    return this.prisma.vehicle.findUnique({
      where: { plateNumber: normalized },
      include: {
        ownerships: { include: { owner: true }, where: { endDate: null } },
      },
    });
  }

  async update(id: string, dto: UpdateVehicleDto) {
    await this.findOne(id);
    return this.prisma.vehicle.update({ where: { id }, data: dto });
  }

  // Transfert de propriété : clôture l'ownership courant et en ouvre un nouveau (feature 11)
  async transferOwnership(vehicleId: string, newOwnerId: string) {
    await this.findOne(vehicleId);
    return this.prisma.$transaction(async (tx) => {
      await tx.vehicleOwnership.updateMany({
        where: { vehicleId, endDate: null },
        data: { endDate: new Date() },
      });
      return tx.vehicleOwnership.create({
        data: { vehicleId, ownerId: newOwnerId, startDate: new Date() },
        include: { owner: true },
      });
    });
  }

  // Reconstruction d'itinéraire : liste les captures d'un véhicule triées
  // chronologiquement avec position GPS, caméra et horodatage.
  async getRoute(vehicleId: string, windowHours = 24) {
    const since = new Date(Date.now() - windowHours * 3_600_000);
    const captures = await this.prisma.capture.findMany({
      where: {
        vehicleId,
        capturedAt: { gte: since },
      },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        capturedAt: true,
        cameraId: true,
        camera: { select: { name: true } },
        imageUrl: true,
        confidence: true,
      },
      orderBy: { capturedAt: 'asc' },
    });

    const points = captures
      .filter((c) => c.latitude != null && c.longitude != null)
      .map((c) => ({
        captureId: c.id,
        lat: c.latitude!,
        lng: c.longitude!,
        capturedAt: c.capturedAt,
        cameraName: c.camera?.name ?? null,
        imageUrl: c.imageUrl,
      }));

    // Calcul de la distance totale parcourue
    let totalDistanceKm = 0;
    for (let i = 1; i < points.length; i++) {
      totalDistanceKm += haversineKm(
        points[i - 1].lat,
        points[i - 1].lng,
        points[i].lat,
        points[i].lng,
      );
    }

    return {
      vehicleId,
      windowHours,
      pointCount: points.length,
      totalDistanceKm: Math.round(totalDistanceKm * 10) / 10,
      points,
    };
  }
}
