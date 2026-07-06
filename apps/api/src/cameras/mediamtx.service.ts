import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

// Synchronise les caméras (streamUrl) vers MediaMTX : chaque caméra devient
// un chemin HLS lisible dans le navigateur (http://<hls>/{cameraId}/index.m3u8).
@Injectable()
export class MediamtxService implements OnModuleInit {
  private readonly logger = new Logger(MediamtxService.name);
  private readonly apiUrl: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.apiUrl = this.config.get<string>('MEDIAMTX_API_URL') ?? 'http://localhost:9997';
  }

  async onModuleInit() {
    await this.syncAll().catch((e) =>
      this.logger.warn(`Synchronisation MediaMTX impossible au démarrage : ${e.message}`),
    );
  }

  async syncAll() {
    const cameras = await this.prisma.camera.findMany({
      where: { streamUrl: { not: null }, active: true },
    });
    for (const camera of cameras) {
      await this.syncCamera(camera.id, camera.streamUrl!, camera.recordingEnabled);
    }
    if (cameras.length > 0) {
      this.logger.log(`${cameras.length} flux caméra synchronisés vers MediaMTX`);
    }
  }

  async syncCamera(cameraId: string, streamUrl: string, record: boolean) {
    const pathConfig = {
      source: streamUrl,
      sourceOnDemand: true,
      record,
      recordPath: `/recordings/${cameraId}/%Y-%m-%d_%H-%M-%S-%f`,
    };
    try {
      // Tente la création, sinon remplace la config existante
      await axios.post(`${this.apiUrl}/v3/config/paths/add/${cameraId}`, pathConfig, {
        timeout: 5000,
      });
    } catch {
      try {
        await axios.patch(`${this.apiUrl}/v3/config/paths/patch/${cameraId}`, pathConfig, {
          timeout: 5000,
        });
      } catch (error) {
        this.logger.warn(
          `Échec de synchronisation du flux ${cameraId}: ${(error as Error).message}`,
        );
        return false;
      }
    }
    return true;
  }

  async removeCamera(cameraId: string) {
    await axios
      .delete(`${this.apiUrl}/v3/config/paths/delete/${cameraId}`, { timeout: 5000 })
      .catch(() => undefined);
  }

  // Diagnostic : liste des chemins actifs côté MediaMTX (flux prêts/en lecture)
  async pathsStatus(): Promise<Record<string, { ready: boolean; readers: number }>> {
    try {
      const res = await axios.get(`${this.apiUrl}/v3/paths/list`, { timeout: 5000 });
      const map: Record<string, { ready: boolean; readers: number }> = {};
      for (const item of res.data.items ?? []) {
        map[item.name] = { ready: !!item.ready, readers: item.readers?.length ?? 0 };
      }
      return map;
    } catch {
      return {};
    }
  }
}
