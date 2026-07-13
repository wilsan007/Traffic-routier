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
  private readonly whipBase: string;
  private readonly rtspBase: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.apiUrl = this.config.get<string>('MEDIAMTX_API_URL') ?? 'http://localhost:9997';
    // Bases d'URL pour la publication depuis un mobile (WHIP/WebRTC) et la
    // relecture RTSP consommée par le worker ML.
    this.whipBase = this.config.get<string>('MEDIAMTX_WHIP_URL') ?? 'http://localhost:8889';
    this.rtspBase = this.config.get<string>('MEDIAMTX_RTSP_URL') ?? 'rtsp://localhost:8554';
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

  // Prépare un chemin MediaMTX qui ACCEPTE une publication (téléphone qui
  // pousse son flux via WHIP/WebRTC), contrairement à syncCamera qui définit
  // une `source` à tirer. Un chemin sans `source` accepte les publieurs.
  async ensurePublishPath(cameraId: string, record = false) {
    const pathConfig = {
      sourceOnDemand: false,
      record,
      recordPath: `/recordings/${cameraId}/%Y-%m-%d_%H-%M-%S-%f`,
    };
    try {
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
          `Échec de préparation du chemin de publication ${cameraId}: ${(error as Error).message}`,
        );
        return false;
      }
    }
    return true;
  }

  // URL WHIP où le mobile publie son flux (WebRTC ingest).
  whipUrl(cameraId: string): string {
    return `${this.whipBase.replace(/\/$/, '')}/${cameraId}/whip`;
  }

  // URL RTSP que le worker ML consomme (POST /streams).
  rtspUrl(cameraId: string): string {
    return `${this.rtspBase.replace(/\/$/, '')}/${cameraId}`;
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
