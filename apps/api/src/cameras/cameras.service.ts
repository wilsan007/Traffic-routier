import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MediamtxService } from './mediamtx.service';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';

// Une caméra est considérée hors ligne sans activité depuis 10 minutes
const OFFLINE_THRESHOLD_MS = 10 * 60_000;

@Injectable()
export class CamerasService {
  constructor(
    private prisma: PrismaService,
    private mediamtx: MediamtxService,
  ) {}

  async create(dto: CreateCameraDto) {
    const camera = await this.prisma.camera.create({ data: dto });
    if (camera.streamUrl) {
      await this.mediamtx.syncCamera(camera.id, camera.streamUrl, camera.recordingEnabled);
    }
    return camera;
  }

  findAll() {
    return this.prisma.camera.findMany({ include: { region: true }, orderBy: { name: 'asc' } });
  }

  // Diagnostics : état en ligne/hors ligne + état du flux MediaMTX
  async diagnostics() {
    const [cameras, streamStatus] = await Promise.all([
      this.findAll(),
      this.mediamtx.pathsStatus(),
    ]);
    const now = Date.now();
    return cameras.map((camera) => ({
      ...camera,
      online:
        camera.lastSeenAt != null &&
        now - new Date(camera.lastSeenAt).getTime() < OFFLINE_THRESHOLD_MS,
      stream: camera.streamUrl
        ? {
            configured: true,
            ready: streamStatus[camera.id]?.ready ?? false,
            readers: streamStatus[camera.id]?.readers ?? 0,
            hlsPath: `/${camera.id}/index.m3u8`,
          }
        : { configured: false },
    }));
  }

  async findOne(id: string) {
    const camera = await this.prisma.camera.findUnique({ where: { id }, include: { region: true } });
    if (!camera) throw new NotFoundException('Caméra introuvable');
    return camera;
  }

  async update(id: string, dto: UpdateCameraDto) {
    await this.findOne(id);
    const camera = await this.prisma.camera.update({ where: { id }, data: dto });
    if (camera.streamUrl) {
      await this.mediamtx.syncCamera(camera.id, camera.streamUrl, camera.recordingEnabled);
    } else {
      await this.mediamtx.removeCamera(camera.id);
    }
    return camera;
  }
}
