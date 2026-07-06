import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.SUPERVISOR, Role.OFFICER)
@Controller('analytics')
export class AnalyticsController {
  constructor(private analyticsService: AnalyticsService) {}

  @Get('overview')
  overview() {
    return this.analyticsService.overview();
  }

  @Get('infractions-by-type')
  infractionsByType(@Query('from') from?: string, @Query('to') to?: string) {
    return this.analyticsService.infractionsByType(from, to);
  }

  @Get('infractions-by-severity')
  infractionsBySeverity() {
    return this.analyticsService.infractionsBySeverity();
  }

  @Get('capture-volume')
  captureVolume(@Query('days') days?: string) {
    return this.analyticsService.captureVolumeByDay(days ? parseInt(days, 10) : undefined);
  }

  @Get('alerts-by-priority')
  alertsByPriority() {
    return this.analyticsService.alertsByPriority();
  }
}
