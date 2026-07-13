import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CamerasService } from './cameras.service';
import { LiveIngestService } from './live-ingest.service';
import { CreateCameraDto } from './dto/create-camera.dto';
import { UpdateCameraDto } from './dto/update-camera.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('cameras')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('cameras')
export class CamerasController {
  constructor(
    private camerasService: CamerasService,
    private liveIngest: LiveIngestService,
  ) {}

  @Post()
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.TECHNICIAN)
  create(@Body() dto: CreateCameraDto) {
    return this.camerasService.create(dto);
  }

  @Get()
  findAll() {
    return this.camerasService.findAll();
  }

  // Diagnostics : en ligne/hors ligne, flux HLS prêt, spectateurs
  @Get('diagnostics')
  diagnostics() {
    return this.camerasService.diagnostics();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.camerasService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.TECHNICIAN)
  update(@Param('id') id: string, @Body() dto: UpdateCameraDto) {
    return this.camerasService.update(id, dto);
  }

  // Diffusion en direct depuis un mobile : prépare l'ingestion WHIP + démarre
  // le worker ML, renvoie l'URL WHIP où le téléphone publie sa caméra.
  @Post(':id/live/start')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.TECHNICIAN, Role.OFFICER)
  startLive(@Param('id') id: string) {
    return this.liveIngest.start(id);
  }

  @Post(':id/live/stop')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.TECHNICIAN, Role.OFFICER)
  stopLive(@Param('id') id: string) {
    return this.liveIngest.stop(id);
  }
}
