import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role, TollTxStatus } from '@prisma/client';
import { IsNumber, IsOptional, IsString } from 'class-validator';
import { TollsService } from './tolls.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

class CreateTollZoneDto {
  @IsString()
  name: string;

  @IsNumber()
  pricePerPassage: number;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsNumber()
  radiusMeters?: number;

  @IsOptional()
  @IsString()
  cameraId?: string;
}

class InvoiceDto {
  @IsOptional()
  @IsString()
  plate?: string;

  @IsOptional()
  @IsString()
  fleetId?: string;
}

@ApiTags('tolls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tolls')
export class TollsController {
  constructor(private tollsService: TollsService) {}

  @Post('zones')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  createZone(@Body() dto: CreateTollZoneDto) {
    return this.tollsService.createZone(dto);
  }

  @Get('zones')
  listZones() {
    return this.tollsService.listZones();
  }

  @Patch('zones/:id/deactivate')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  deactivateZone(@Param('id') id: string) {
    return this.tollsService.deactivateZone(id);
  }

  @Get('transactions')
  listTransactions(
    @Query('zoneId') zoneId?: string,
    @Query('plate') plate?: string,
    @Query('status') status?: TollTxStatus,
  ) {
    return this.tollsService.listTransactions({ zoneId, plate, status });
  }

  @Post('invoice')
  @Roles(Role.ADMIN, Role.SUPERVISOR, Role.CASHIER)
  invoice(@Body() dto: InvoiceDto) {
    return this.tollsService.invoice(dto);
  }
}
