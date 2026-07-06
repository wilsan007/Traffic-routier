import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InfractionStatus, Role } from '@prisma/client';
import { InfractionsService } from './infractions.service';
import { PvPdfService } from './pv-pdf.service';
import { CreateInfractionDto } from './dto/create-infraction.dto';
import {
  CancelInfractionDto,
  DecideDisputeDto,
  OpenDisputeDto,
  RecordPaymentDto,
  RejectInfractionDto,
} from './dto/workflow.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('infractions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('infractions')
export class InfractionsController {
  constructor(
    private infractionsService: InfractionsService,
    private pvPdfService: PvPdfService,
  ) {}

  @Post()
  create(
    @Body() dto: CreateInfractionDto,
    @Query('draft') draft: string,
    @CurrentUser() user: { userId: string },
  ) {
    return this.infractionsService.create(dto, user.userId, draft === 'true');
  }

  @Get()
  findAll(
    @Query('vehicleId') vehicleId?: string,
    @Query('ownerId') ownerId?: string,
    @Query('status') status?: InfractionStatus,
  ) {
    return this.infractionsService.findAll({ vehicleId, ownerId, status });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.infractionsService.findOne(id);
  }

  // Procès-verbal officiel en PDF
  @Get(':id/pdf')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const i = await this.infractionsService.findOne(id);
    const owner = i.owner ?? i.vehicle.ownerships?.[0]?.owner ?? null;
    const buffer = await this.pvPdfService.generate({
      reference: i.reference ?? i.id,
      status: i.status,
      occurredAt: i.occurredAt,
      label: i.type,
      description: i.description,
      fineAmount: i.fineAmount,
      amountDue: i.amountDue,
      points: i.points,
      dueDate: i.dueDate,
      plate: i.vehicle.plateNumber,
      vehicleLabel: [i.vehicle.make, i.vehicle.model, i.vehicle.color].filter(Boolean).join(' '),
      ownerName: owner ? `${owner.firstName} ${owner.lastName}` : null,
      ownerAddress: owner?.address,
      officerName: `${i.officer.firstName} ${i.officer.lastName}`,
      officerBadge: i.officer.badgeNumber,
      validatedByName: i.validatedBy
        ? `${i.validatedBy.firstName} ${i.validatedBy.lastName}`
        : null,
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${i.reference ?? i.id}.pdf"`,
    });
    res.send(buffer);
  }

  // --- Workflow ---

  @Patch(':id/submit')
  submit(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.infractionsService.submitForReview(id, user.userId);
  }

  @Patch(':id/validate')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  validate(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.infractionsService.validate(id, user.userId);
  }

  @Patch(':id/reject')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectInfractionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.infractionsService.reject(id, user.userId, dto.reason);
  }

  @Patch(':id/notify')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.CASHIER)
  notify(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.infractionsService.notify(id, user.userId);
  }

  @Post(':id/payments')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.CASHIER)
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.infractionsService.recordPayment(id, {
      method: dto.method,
      payerName: dto.payerName,
      recordedById: user.userId,
    });
  }

  @Post(':id/dispute')
  openDispute(@Param('id') id: string, @Body() dto: OpenDisputeDto) {
    return this.infractionsService.openDispute(id, dto);
  }

  @Patch(':id/dispute/decide')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  decideDispute(
    @Param('id') id: string,
    @Body() dto: DecideDisputeDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.infractionsService.decideDispute(id, {
      accept: dto.accept,
      decision: dto.decision,
      decidedById: user.userId,
    });
  }

  @Patch(':id/close')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.CASHIER)
  close(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    return this.infractionsService.close(id, user.userId);
  }

  @Patch(':id/cancel')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelInfractionDto,
    @CurrentUser() user: { userId: string },
  ) {
    return this.infractionsService.cancel(id, user.userId, dto.reason);
  }
}
