import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from './mediamtx.service';
import { MlClientService } from '../captures/ml-client.service';

// Orchestration de la diffusion en direct depuis un mobile.
//
// Enchaînement (option « streaming téléphone → serveur ») :
//   1. on prépare un chemin MediaMTX qui accepte une publication WHIP ;
//   2. on démarre le worker ML sur l'URL RTSP correspondante (POST /streams) —
//      il ré-essaie tant que le mobile ne publie pas encore ;
//   3. on renvoie l'URL WHIP au mobile, qui publie sa caméra dessus.
//
// Le pipeline ML complet (mouvement → suivi ByteTrack → plaque → vote) tourne
// alors sur le flux continu, et les captures reviennent via /captures/stream.
@Injectable()
export class LiveIngestService {
  private readonly logger = new Logger(LiveIngestService.name);
  // Association caméra → identifiant de flux ML actif (pour l'arrêt).
  private readonly activeStreams = new Map<string, string>();

  constructor(
    private prisma: PrismaService,
    private mediamtx: MediamtxService,
    private ml: MlClientService,
  ) {}

  async start(cameraId: string): Promise<{ whipUrl: string; streamId: string | null }> {
    const camera = await this.prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera) throw new NotFoundException('Caméra introuvable');

    await this.mediamtx.ensurePublishPath(cameraId, camera.recordingEnabled);

    // Un flux ML peut déjà tourner pour cette caméra (double appel) : on le
    // réutilise plutôt que d'en empiler un second.
    let streamId = this.activeStreams.get(cameraId) ?? null;
    if (!streamId) {
      const stream = await this.ml.startStream(this.mediamtx.rtspUrl(cameraId), cameraId);
      streamId = stream?.id ?? null;
      if (streamId) {
        this.activeStreams.set(cameraId, streamId);
        this.logger.log(`Diffusion démarrée pour la caméra ${cameraId} (flux ML ${streamId})`);
      }
    }

    return { whipUrl: this.mediamtx.whipUrl(cameraId), streamId };
  }

  async stop(cameraId: string): Promise<{ stopped: boolean }> {
    const streamId = this.activeStreams.get(cameraId);
    if (streamId) {
      await this.ml.stopStream(streamId);
      this.activeStreams.delete(cameraId);
    }
    await this.mediamtx.removeCamera(cameraId);
    this.logger.log(`Diffusion arrêtée pour la caméra ${cameraId}`);
    return { stopped: true };
  }
}
