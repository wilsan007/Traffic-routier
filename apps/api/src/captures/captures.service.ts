import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { MlClientService } from './ml-client.service';
import { HotlistService } from '../hotlist/hotlist.service';
import { AlertsService } from '../alerts/alerts.service';
import { AuditService } from '../common/audit/audit.service';
import { PatternsService } from '../patterns/patterns.service';
import { TollsService } from '../tolls/tolls.service';

// Champs sûrs à exposer pour un utilisateur relié (agent, valideur, etc.) —
// exclut notamment passwordHash, qui ne doit jamais transiter par l'API.
const OFFICER_SAFE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  badgeNumber: true,
  role: true,
} as const;

export interface IngestCaptureParams {
  imageBuffer: Buffer;
  cameraId?: string;
  officerId?: string;
  latitude?: number;
  longitude?: number;
  // Détection déjà effectuée en amont (worker de flux vidéo) — évite un
  // second appel au service ML.
  preDetected?: { plateText: string; confidence: number };
}

@Injectable()
export class CapturesService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private mlClient: MlClientService,
    private hotlistService: HotlistService,
    private alertsService: AlertsService,
    private audit: AuditService,
    private patternsService: PatternsService,
    private tollsService: TollsService,
  ) {}

  // Correspondance approchée : tolère 1 caractère d'écart OCR (distance de
  // Levenshtein) entre la plaque lue et le registre. N'accepte que si le
  // candidat est unique, pour éviter les faux positifs entre plaques proches.
  private async fuzzyFindVehicle(normalized: string) {
    if (normalized.length < 5) return null;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Vehicle"
      WHERE levenshtein("plateNumber", ${normalized}) <= 1
      LIMIT 2`;
    if (rows.length !== 1) return null;
    return this.prisma.vehicle.findUnique({ where: { id: rows[0].id } });
  }

  async ingest(params: IngestCaptureParams) {
    const imageUrl = await this.storage.uploadCaptureImage(params.imageBuffer);
    const detection =
      params.preDetected ?? (await this.mlClient.detectPlate(params.imageBuffer));
    const normalized = detection.plateText.toUpperCase().replace(/\s+/g, '');

    let fuzzyMatch = false;
    let vehicle = normalized
      ? await this.prisma.vehicle.findUnique({ where: { plateNumber: normalized } })
      : null;
    if (!vehicle && normalized) {
      vehicle = await this.fuzzyFindVehicle(normalized);
      fuzzyMatch = vehicle != null;
    }

    const capture = await this.prisma.capture.create({
      data: {
        cameraId: params.cameraId,
        officerId: params.officerId,
        imageUrl,
        plateNumberRaw: detection.plateText,
        plateNumberNormalized: normalized,
        confidence: detection.confidence,
        vehicleId: vehicle?.id,
        latitude: params.latitude,
        longitude: params.longitude,
      },
      include: {
        vehicle: true,
        camera: true,
        officer: { select: OFFICER_SAFE_SELECT },
      },
    });

    // La hotlist est aussi comparée sur la plaque du véhicule identifié en
    // correspondance approchée, pas seulement sur la lecture OCR brute.
    const platesToCheck = new Set<string>();
    if (normalized) platesToCheck.add(normalized);
    if (vehicle) platesToCheck.add(vehicle.plateNumber);
    const hotlistMatches = (
      await Promise.all([...platesToCheck].map((p) => this.hotlistService.matchPlate(p)))
    ).flat();
    const uniqueMatches = [...new Map(hotlistMatches.map((m) => [m.id, m])).values()];
    const alerts = await Promise.all(
      uniqueMatches.map((entry) => this.alertsService.createFromMatch(entry.id, capture.id)),
    );

    // Détection de plaque clonée : même plaque vue ailleurs à une vitesse
    // implicite impossible → alerte automatique
    const cloneAlert = await this.patternsService
      .checkClonedPlate(capture)
      .catch(() => null);
    if (cloneAlert) alerts.push(cloneAlert);

    // Détection de passages répétés sur la même caméra/zone
    const passageAlert = await this.patternsService
      .checkRepeatedPassage(capture)
      .catch(() => null);
    if (passageAlert) alerts.push(passageAlert);

    // Estimation de vitesse entre deux caméras → alerte + PV auto
    const speedResult = await this.patternsService
      .checkSpeedViolation(capture)
      .catch(() => null);
    if (speedResult?.alert) alerts.push(speedResult.alert);

    // Passage en zone de péage → transaction automatique
    const tollTransaction = await this.tollsService
      .processCapture(capture)
      .catch(() => null);

    // Diagnostic caméra : trace la dernière activité
    if (params.cameraId) {
      await this.prisma.camera
        .update({ where: { id: params.cameraId }, data: { lastSeenAt: new Date() } })
        .catch(() => undefined);
    }

    await this.audit.log({
      userId: params.officerId,
      action: 'CAPTURE_INGESTED',
      entityType: 'Capture',
      entityId: capture.id,
      metadata: {
        plate: normalized,
        confidence: detection.confidence,
        fuzzyMatch,
        hotlistMatches: uniqueMatches.length,
      },
    });

    return { capture, vehicleMatch: vehicle, fuzzyMatch, hotlistAlerts: alerts, tollTransaction };
  }

  findAll(params: { plate?: string; from?: string; to?: string } = {}) {
    return this.prisma.capture.findMany({
      where: {
        plateNumberNormalized: params.plate
          ? { contains: params.plate.toUpperCase().replace(/\s+/g, '') }
          : undefined,
        capturedAt: {
          gte: params.from ? new Date(params.from) : undefined,
          lte: params.to ? new Date(params.to) : undefined,
        },
      },
      include: { vehicle: true, camera: true },
      orderBy: { capturedAt: 'desc' },
      take: 200,
    });
  }

  async findOne(id: string) {
    const capture = await this.prisma.capture.findUnique({
      where: { id },
      include: {
        vehicle: true,
        camera: true,
        officer: { select: OFFICER_SAFE_SELECT },
        alerts: true,
      },
    });
    if (!capture) throw new NotFoundException('Capture introuvable');
    return capture;
  }

  // File de vérification manuelle pour les résultats OCR à faible confiance
  findLowConfidence(threshold = 0.6) {
    return this.prisma.capture.findMany({
      where: { confidence: { lt: threshold }, verified: false },
      orderBy: { capturedAt: 'desc' },
      take: 100,
    });
  }

  async verify(id: string, correctedPlate: string, verifiedById: string) {
    const normalized = correctedPlate.toUpperCase().replace(/\s+/g, '');
    const vehicle = await this.prisma.vehicle.findUnique({ where: { plateNumber: normalized } });
    return this.prisma.capture.update({
      where: { id },
      data: {
        plateNumberNormalized: normalized,
        vehicleId: vehicle?.id,
        verified: true,
        verifiedById,
      },
    });
  }
}
