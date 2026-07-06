import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role, AlertStatus } from '@prisma/client';
import { AlertsService } from './alerts.service';
import { ResolveAlertDto } from './dto/resolve-alert.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('alerts')
export class AlertsController {
  constructor(private alertsService: AlertsService) {}

  @Get()
  findAll(@Query('status') status?: AlertStatus) {
    return this.alertsService.findAll(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.alertsService.findOne(id);
  }

  @Patch(':id/acknowledge')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.OFFICER)
  acknowledge(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.alertsService.acknowledge(id, user.userId);
  }

  @Patch(':id/resolve')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  resolve(@Param('id') id: string, @Body() dto: ResolveAlertDto) {
    return this.alertsService.resolve(id, dto.status as any);
  }
}
