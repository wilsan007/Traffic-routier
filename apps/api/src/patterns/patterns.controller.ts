import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PatternsService } from './patterns.service';
import { CreateZoneDto } from './dto/create-zone.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('patterns')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('patterns')
export class PatternsController {
  constructor(private patternsService: PatternsService) {}

  @Get('suspicious')
  suspicious(@Query('windowHours') windowHours?: string, @Query('minZones') minZones?: string) {
    return this.patternsService.suspiciousPatterns(
      windowHours ? parseInt(windowHours, 10) : undefined,
      minZones ? parseInt(minZones, 10) : undefined,
    );
  }

  @Get('convoys')
  convoys(
    @Query('windowHours') windowHours?: string,
    @Query('minCoOccurrences') minCoOccurrences?: string,
  ) {
    return this.patternsService.detectConvoys(
      windowHours ? parseInt(windowHours, 10) : undefined,
      minCoOccurrences ? parseInt(minCoOccurrences, 10) : undefined,
    );
  }

  @Get('repeated-passages')
  repeatedPassages() {
    return this.patternsService.getRepeatedPassages();
  }

  @Get('zones')
  listZones() {
    return this.patternsService.listZones();
  }

  @Post('zones')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  createZone(@Body() dto: CreateZoneDto) {
    return this.patternsService.createZone(dto);
  }

  @Delete('zones/:id')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  deleteZone(@Param('id') id: string) {
    return this.patternsService.deleteZone(id);
  }
}
