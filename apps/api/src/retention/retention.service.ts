import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../common/audit/audit.service';

export interface RetentionResult {
  dryRun: boolean;
  unmatchedDeleted: number;
  matchedDeleted: number;
  imagesDeleted: number;
  policy: { unmatchedDays: number; matchedDays: number };
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private audit: AuditService,
    private config: ConfigService,
  ) {}

  private get policy() {
    return {
      // Captures sans correspondance véhicule : purge rapide (RGPD, minimisation)
      unmatchedDays: parseInt(this.config.get('RETENTION_UNMATCHED_DAYS') ?? '30', 10),
      // Captures liées à un véhicule mais sans alerte : conservation plus longue
      matchedDays: parseInt(this.config.get('RETENTION_MATCHED_DAYS') ?? '365', 10),
    };
  }

  // Tous les jours à 03h00 — les captures liées à une alerte (preuves) ne sont
  // jamais purgées automatiquement.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async scheduledPurge() {
    const result = await this.purge(false);
    this.logger.log(
      `Purge de rétention : ${result.unmatchedDeleted} captures sans correspondance, ${result.matchedDeleted} anciennes captures, ${result.imagesDeleted} images supprimées`,
    );
  }

  async purge(dryRun = false): Promise<RetentionResult> {
    const { unmatchedDays, matchedDays } = this.policy;
    const now = Date.now();
    const unmatchedBefore = new Date(now - unmatchedDays * 86_400_000);
    const matchedBefore = new Date(now - matchedDays * 86_400_000);

    const [unmatched, matched] = await Promise.all([
      this.prisma.capture.findMany({
        where: {
          capturedAt: { lt: unmatchedBefore },
          vehicleId: null,
          alerts: { none: {} },
          infractions: { none: {} },
        },
        select: { id: true, imageUrl: true },
      }),
      this.prisma.capture.findMany({
        where: {
          capturedAt: { lt: matchedBefore },
          vehicleId: { not: null },
          alerts: { none: {} },
          infractions: { none: {} },
        },
        select: { id: true, imageUrl: true },
      }),
    ]);

    const toDelete = [...unmatched, ...matched];
    let imagesDeleted = 0;

    if (!dryRun && toDelete.length > 0) {
      for (const capture of toDelete) {
        if (await this.storage.deleteByUrl(capture.imageUrl)) imagesDeleted++;
      }
      await this.prisma.capture.deleteMany({
        where: { id: { in: toDelete.map((c) => c.id) } },
      });
      await this.audit.log({
        action: 'RETENTION_PURGE',
        entityType: 'Capture',
        metadata: {
          unmatchedDeleted: unmatched.length,
          matchedDeleted: matched.length,
          imagesDeleted,
          policy: this.policy,
        },
      });
    }

    return {
      dryRun,
      unmatchedDeleted: unmatched.length,
      matchedDeleted: matched.length,
      imagesDeleted,
      policy: this.policy,
    };
  }
}
