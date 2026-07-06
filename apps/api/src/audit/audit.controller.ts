import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit-logs')
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  findAll(
    @Query('userId') userId?: string,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
  ) {
    return this.prisma.auditLog.findMany({
      where: { userId, entityType, action },
      include: { user: { select: { firstName: true, lastName: true, badgeNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }
}
