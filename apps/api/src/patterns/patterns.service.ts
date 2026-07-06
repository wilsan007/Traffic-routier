import { Injectable, Logger } from '@nestjs/common';
import { HotlistReason, InfractionSeverity, InfractionStatus, Priority } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AlertsService } from '../alerts/alerts.service';

// Vitesse maximale plausible entre deux caméras (km/h). Au-delà, la même
// plaque vue à deux endroits implique une plaque clonée.
const MAX_PLAUSIBLE_SPEED_KMH = 250;
// Fenêtre de recherche du passage précédent (minutes)
const CLONE_LOOKBACK_MINUTES = 60;

// --- Paramètres détection de passages répétés ---
const PASSAGE_WINDOW_HOURS = 1;
const PASSAGE_ALERT_THRESHOLD = 3;

// --- Paramètres détection de convoi ---
const CONVOY_WINDOW_HOURS = 6;
const CONVOY_MAX_GAP_MINUTES = 10;
const CONVOY_MIN_COOCCURRENCES = 3;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

@Injectable()
export class PatternsService {
  private readonly logger = new Logger(PatternsService.name);

  constructor(
    private prisma: PrismaService,
    private alertsService: AlertsService,
  ) {}

  /**
   * Détection de plaque clonée : si la même plaque a été capturée récemment à
   * une distance impliquant une vitesse impossible, on crée une entrée de
   * surveillance CLONED_PLATE et une alerte critique.
   * Appelé à chaque ingestion de capture géolocalisée.
   */
  async checkClonedPlate(capture: {
    id: string;
    plateNumberNormalized: string;
    latitude: number | null;
    longitude: number | null;
    capturedAt: Date;
  }) {
    if (!capture.plateNumberNormalized || capture.latitude == null || capture.longitude == null) {
      return null;
    }

    const since = new Date(capture.capturedAt.getTime() - CLONE_LOOKBACK_MINUTES * 60_000);
    const previous = await this.prisma.capture.findFirst({
      where: {
        id: { not: capture.id },
        plateNumberNormalized: capture.plateNumberNormalized,
        capturedAt: { gte: since, lte: capture.capturedAt },
        latitude: { not: null },
        longitude: { not: null },
      },
      orderBy: { capturedAt: 'desc' },
    });
    if (!previous) return null;

    const distanceKm = haversineKm(
      previous.latitude!,
      previous.longitude!,
      capture.latitude,
      capture.longitude,
    );
    const hours = Math.max(
      (capture.capturedAt.getTime() - previous.capturedAt.getTime()) / 3_600_000,
      1 / 3600, // plancher 1 seconde pour éviter la division par zéro
    );
    const impliedSpeed = distanceKm / hours;
    if (impliedSpeed <= MAX_PLAUSIBLE_SPEED_KMH) return null;

    this.logger.warn(
      `Plaque clonée suspectée: ${capture.plateNumberNormalized} — ${distanceKm.toFixed(1)} km en ${(hours * 60).toFixed(1)} min (${impliedSpeed.toFixed(0)} km/h)`,
    );

    // Réutilise l'entrée CLONED_PLATE active si elle existe déjà pour cette plaque
    let entry = await this.prisma.hotlistEntry.findFirst({
      where: {
        plateNumber: capture.plateNumberNormalized,
        reason: HotlistReason.CLONED_PLATE,
        active: true,
      },
    });
    if (!entry) {
      const systemUser = await this.prisma.user.findFirst({
        where: { role: 'ADMIN', active: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!systemUser) return null;
      entry = await this.prisma.hotlistEntry.create({
        data: {
          plateNumber: capture.plateNumberNormalized,
          reason: HotlistReason.CLONED_PLATE,
          priority: Priority.HIGH,
          notes: `Détection automatique : ${distanceKm.toFixed(1)} km parcourus en ${(hours * 60).toFixed(1)} min (vitesse implicite ${impliedSpeed.toFixed(0)} km/h). Plaque probablement clonée.`,
          createdById: systemUser.id,
        },
      });
    }

    return this.alertsService.createFromMatch(entry.id, capture.id);
  }

  /**
   * Plaques vues dans plusieurs zones sensibles distinctes sur les dernières
   * 24 h — signal de repérage/surveillance hostile.
   */
  async suspiciousPatterns(windowHours = 24, minZones = 2) {
    const since = new Date(Date.now() - windowHours * 3_600_000);
    const [zones, captures] = await Promise.all([
      this.prisma.sensitiveZone.findMany(),
      this.prisma.capture.findMany({
        where: {
          capturedAt: { gte: since },
          latitude: { not: null },
          longitude: { not: null },
          plateNumberNormalized: { not: '' },
        },
        select: {
          plateNumberNormalized: true,
          latitude: true,
          longitude: true,
          capturedAt: true,
        },
      }),
    ]);
    if (zones.length === 0) return [];

    const plateZones = new Map<string, Map<string, { zone: string; lastSeen: Date }>>();
    for (const c of captures) {
      for (const z of zones) {
        const distM = haversineKm(z.latitude, z.longitude, c.latitude!, c.longitude!) * 1000;
        if (distM > z.radiusMeters) continue;
        let entry = plateZones.get(c.plateNumberNormalized);
        if (!entry) {
          entry = new Map();
          plateZones.set(c.plateNumberNormalized, entry);
        }
        const existing = entry.get(z.id);
        if (!existing || existing.lastSeen < c.capturedAt) {
          entry.set(z.id, { zone: z.name, lastSeen: c.capturedAt });
        }
      }
    }

    return [...plateZones.entries()]
      .filter(([, zoneHits]) => zoneHits.size >= minZones)
      .map(([plate, zoneHits]) => ({
        plateNumber: plate,
        zoneCount: zoneHits.size,
        zones: [...zoneHits.values()].map((v) => ({ name: v.zone, lastSeen: v.lastSeen })),
      }))
      .sort((a, b) => b.zoneCount - a.zoneCount);
  }

  // --- CRUD zones sensibles ---

  /**
   * Détection de passages répétés : une plaque passant N fois sur la même
   * caméra (ou dans la même zone sensible) dans une fenêtre de temps
   * configurable. Crée une entrée REPEATED_PASSAGE + alerte si seuil atteint.
   * Appelé à chaque ingestion de capture.
   */
  async checkRepeatedPassage(capture: {
    id: string;
    plateNumberNormalized: string;
    cameraId: string | null;
    latitude: number | null;
    longitude: number | null;
    capturedAt: Date;
  }) {
    if (!capture.plateNumberNormalized) return null;

    const since = new Date(capture.capturedAt.getTime() - PASSAGE_WINDOW_HOURS * 3_600_000);

    // Compter les passages de cette plaque dans la même fenêtre
    // Soit sur la même caméra, soit dans la même zone sensible (si géolocalisé)
    let count = 0;
    let scope = 'caméra';

    if (capture.cameraId) {
      count = await this.prisma.capture.count({
        where: {
          id: { not: capture.id },
          plateNumberNormalized: capture.plateNumberNormalized,
          cameraId: capture.cameraId,
          capturedAt: { gte: since, lte: capture.capturedAt },
        },
      });
    }

    // Si pas de caméra ou count insuffisant, vérifier les zones sensibles
    if (count < PASSAGE_ALERT_THRESHOLD && capture.latitude != null && capture.longitude != null) {
      const zones = await this.prisma.sensitiveZone.findMany();
      const matchingZone = zones.find(
        (z) =>
          haversineKm(z.latitude, z.longitude, capture.latitude!, capture.longitude!) * 1000 <=
          z.radiusMeters,
      );
      if (matchingZone) {
        const zoneCaptures = await this.prisma.capture.findMany({
          where: {
            id: { not: capture.id },
            plateNumberNormalized: capture.plateNumberNormalized,
            capturedAt: { gte: since, lte: capture.capturedAt },
            latitude: { not: null },
            longitude: { not: null },
          },
          select: { latitude: true, longitude: true },
        });
        count = zoneCaptures.filter(
          (c) =>
            haversineKm(matchingZone.latitude, matchingZone.longitude, c.latitude!, c.longitude!) *
              1000 <=
            matchingZone.radiusMeters,
        ).length;
        scope = `zone « ${matchingZone.name} »`;
      }
    }

    if (count < PASSAGE_ALERT_THRESHOLD) return null;

    this.logger.warn(
      `Passages répétés: ${capture.plateNumberNormalized} — ${count + 1} passages en ${PASSAGE_WINDOW_HOURS}h sur ${scope}`,
    );

    let entry = await this.prisma.hotlistEntry.findFirst({
      where: {
        plateNumber: capture.plateNumberNormalized,
        reason: HotlistReason.REPEATED_PASSAGE,
        active: true,
      },
    });
    if (!entry) {
      const systemUser = await this.prisma.user.findFirst({
        where: { role: 'ADMIN', active: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!systemUser) return null;
      entry = await this.prisma.hotlistEntry.create({
        data: {
          plateNumber: capture.plateNumberNormalized,
          reason: HotlistReason.REPEATED_PASSAGE,
          priority: Priority.MEDIUM,
          notes: `Détection automatique : ${count + 1} passages détectés en ${PASSAGE_WINDOW_HOURS}h sur ${scope}.`,
          createdById: systemUser.id,
        },
      });
    }

    return this.alertsService.createFromMatch(entry.id, capture.id);
  }

  /**
   * Estimation de vitesse entre deux caméras : si la même plaque est capturée
   * sur deux caméras distinctes et que la vitesse implicite dépasse la limite
   * configurée, génère une alerte SPEED_VIOLATION et un PV d'excès de vitesse.
   * Appelé à chaque ingestion de capture géolocalisée.
   */
  async checkSpeedViolation(capture: {
    id: string;
    plateNumberNormalized: string;
    cameraId: string | null;
    capturedAt: Date;
    vehicleId: string | null;
  }) {
    if (!capture.plateNumberNormalized || !capture.cameraId) return null;

    const currentCamera = await this.prisma.camera.findUnique({
      where: { id: capture.cameraId },
      select: { latitude: true, longitude: true, maxSpeedKmh: true, name: true },
    });
    if (!currentCamera?.latitude || !currentCamera?.longitude) return null;

    const since = new Date(capture.capturedAt.getTime() - 2 * 3_600_000); // 2h lookback
    const previous = await this.prisma.capture.findFirst({
      where: {
        id: { not: capture.id },
        plateNumberNormalized: capture.plateNumberNormalized,
        cameraId: { not: capture.cameraId },
        capturedAt: { gte: since, lt: capture.capturedAt },
      },
      orderBy: { capturedAt: 'desc' },
      include: { camera: { select: { latitude: true, longitude: true, maxSpeedKmh: true, name: true } } },
    });
    if (!previous || !previous.camera?.latitude || !previous.camera?.longitude) return null;

    const distanceKm = haversineKm(
      previous.camera.latitude,
      previous.camera.longitude,
      currentCamera.latitude,
      currentCamera.longitude,
    );
    if (distanceKm < 0.1) return null; // trop proche pour être fiable

    const hours = Math.max(
      (capture.capturedAt.getTime() - previous.capturedAt.getTime()) / 3_600_000,
      1 / 3600,
    );
    const speedKmh = distanceKm / hours;

    // Limite : la plus restrictive des deux caméras, ou 130 par défaut
    const limit = Math.min(
      currentCamera.maxSpeedKmh ?? 130,
      previous.camera.maxSpeedKmh ?? 130,
    );
    if (speedKmh <= limit) return null;

    const overshoot = Math.round(((speedKmh - limit) / limit) * 100);
    this.logger.warn(
      `Excès de vitesse: ${capture.plateNumberNormalized} — ${speedKmh.toFixed(0)} km/h (limite ${limit}) entre ${previous.camera.name} et ${currentCamera.name}`,
    );

    // Alerte SPEED_VIOLATION
    let entry = await this.prisma.hotlistEntry.findFirst({
      where: {
        plateNumber: capture.plateNumberNormalized,
        reason: HotlistReason.SPEED_VIOLATION,
        active: true,
      },
    });
    if (!entry) {
      const systemUser = await this.prisma.user.findFirst({
        where: { role: 'ADMIN', active: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!systemUser) return null;
      entry = await this.prisma.hotlistEntry.create({
        data: {
          plateNumber: capture.plateNumberNormalized,
          reason: HotlistReason.SPEED_VIOLATION,
          priority: Priority.HIGH,
          notes: `Détection automatique : ${speedKmh.toFixed(0)} km/h sur section limitée à ${limit} km/h (+${overshoot}%) entre ${previous.camera.name} et ${currentCamera.name}.`,
          createdById: systemUser.id,
        },
      });
    }
    const alert = await this.alertsService.createFromMatch(entry.id, capture.id);

    // PV d'excès de vitesse automatique si le véhicule est identifié
    let infraction: { id: string; reference: string | null } | null = null;
    if (capture.vehicleId) {
      const systemUser = await this.prisma.user.findFirst({
        where: { role: 'ADMIN', active: true },
        orderBy: { createdAt: 'asc' },
      });
      if (systemUser) {
        const year = new Date().getFullYear();
        const count = await this.prisma.infraction.count();
        const reference = `PV-${year}-${String(count + 1).padStart(6, '0')}`;
        const fineAmount = overshoot > 50 ? 300 : overshoot > 20 ? 135 : 68;
        const points = overshoot > 50 ? 6 : overshoot > 20 ? 2 : 1;
        infraction = await this.prisma.infraction.create({
          data: {
            reference,
            vehicleId: capture.vehicleId,
            officerId: systemUser.id,
            captureId: capture.id,
            type: `Excès de vitesse ${overshoot}% (section ${previous.camera.name} → ${currentCamera.name})`,
            description: `Vitesse estimée ${speedKmh.toFixed(0)} km/h pour une limite de ${limit} km/h. Distance ${distanceKm.toFixed(1)} km en ${(hours * 60).toFixed(1)} min.`,
            severity: overshoot > 50 ? InfractionSeverity.CRITICAL : InfractionSeverity.MAJOR,
            fineAmount,
            amountDue: fineAmount,
            points,
            status: InfractionStatus.PENDING_REVIEW,
            occurredAt: capture.capturedAt,
          },
        });
        this.logger.log(`PV auto-généré: ${reference} — ${fineAmount}€ / ${points} pts`);
      }
    }

    return { alert, infraction };
  }

  /**
   * Détection de convoi : identifie des paires de plaques capturées sur les
   * mêmes caméras dans un court intervalle de temps, de façon répétée.
   * Retourne les paires suspectes avec leur nombre de co-occurrences.
   */
  async detectConvoys(windowHours = CONVOY_WINDOW_HOURS, minCoOccurrences = CONVOY_MIN_COOCCURRENCES) {
    const since = new Date(Date.now() - windowHours * 3_600_000);
    const captures = await this.prisma.capture.findMany({
      where: {
        capturedAt: { gte: since },
        cameraId: { not: null },
        plateNumberNormalized: { not: '' },
      },
      select: {
        plateNumberNormalized: true,
        cameraId: true,
        capturedAt: true,
      },
      orderBy: { capturedAt: 'asc' },
    });

    if (captures.length < 2) return [];

    // Grouper par caméra
    const byCamera = new Map<string, typeof captures>();
    for (const c of captures) {
      const arr = byCamera.get(c.cameraId!);
      if (arr) arr.push(c);
      else byCamera.set(c.cameraId!, [c]);
    }

    // Pour chaque caméra, trouver les paires de plaques passant dans un court intervalle
    const pairCounts = new Map<string, { plateA: string; plateB: string; coOccurrences: number; cameras: Set<string>; lastSeen: Date }>();

    for (const [, camCaptures] of byCamera) {
      for (let i = 0; i < camCaptures.length; i++) {
        for (let j = i + 1; j < camCaptures.length; j++) {
          const a = camCaptures[i];
          const b = camCaptures[j];
          if (a.plateNumberNormalized === b.plateNumberNormalized) continue;
          const gapMs = Math.abs(b.capturedAt.getTime() - a.capturedAt.getTime());
          if (gapMs > CONVOY_MAX_GAP_MINUTES * 60_000) break; // trié par temps, on peut stopper
          if (gapMs < 1000) continue; // même instant = probablement la même frame

          const key = [a.plateNumberNormalized, b.plateNumberNormalized].sort().join('|');
          const existing = pairCounts.get(key);
          if (existing) {
            existing.coOccurrences++;
            existing.cameras.add(a.cameraId!);
            if (b.capturedAt > existing.lastSeen) existing.lastSeen = b.capturedAt;
          } else {
            pairCounts.set(key, {
              plateA: a.plateNumberNormalized,
              plateB: b.plateNumberNormalized,
              coOccurrences: 1,
              cameras: new Set([a.cameraId!]),
              lastSeen: b.capturedAt,
            });
          }
        }
      }
    }

    return [...pairCounts.values()]
      .filter((p) => p.coOccurrences >= minCoOccurrences && p.cameras.size >= 2)
      .map((p) => ({
        plateA: p.plateA,
        plateB: p.plateB,
        coOccurrences: p.coOccurrences,
        cameraCount: p.cameras.size,
        lastSeen: p.lastSeen,
      }))
      .sort((a, b) => b.coOccurrences - a.coOccurrences);
  }

  /**
   * Liste des alertes de passages répétés actives.
   */
  async getRepeatedPassages() {
    const entries = await this.prisma.hotlistEntry.findMany({
      where: { reason: HotlistReason.REPEATED_PASSAGE, active: true },
      include: {
        alerts: {
          include: { capture: { select: { capturedAt: true, cameraId: true, imageUrl: true } } },
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return entries;
  }

  createZone(data: { name: string; latitude: number; longitude: number; radiusMeters?: number }) {
    return this.prisma.sensitiveZone.create({ data });
  }

  listZones() {
    return this.prisma.sensitiveZone.findMany({ orderBy: { name: 'asc' } });
  }

  deleteZone(id: string) {
    return this.prisma.sensitiveZone.delete({ where: { id } });
  }
}
