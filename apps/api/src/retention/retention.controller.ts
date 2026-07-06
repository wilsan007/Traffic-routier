import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { RetentionService } from './retention.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('retention')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('retention')
export class RetentionController {
  constructor(private retentionService: RetentionService) {}

  @Get('policy')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  policy() {
    return this.retentionService.purge(true);
  }

  @Post('run')
  @Roles(Role.ADMIN)
  run(@Query('dryRun') dryRun?: string) {
    return this.retentionService.purge(dryRun === 'true');
  }
}
