import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

class CreateFleetDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  contactName?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;
}

class AssignVehicleDto {
  @IsString()
  vehicleId: string;
}

@ApiTags('fleets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('fleets')
export class FleetsController {
  constructor(private prisma: PrismaService) {}

  @Post()
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  create(@Body() dto: CreateFleetDto) {
    return this.prisma.fleet.create({ data: dto });
  }

  @Get()
  findAll() {
    return this.prisma.fleet.findMany({
      include: { _count: { select: { vehicles: true } } },
      orderBy: { name: 'asc' },
    });
  }

  // Vue consolidée : véhicules + infractions + montant dû par flotte
  @Get(':id')
  async findOne(@Param('id') id: string) {
    const fleet = await this.prisma.fleet.findUniqueOrThrow({
      where: { id },
      include: {
        vehicles: {
          include: {
            infractions: {
              select: { id: true, reference: true, type: true, status: true, amountDue: true, occurredAt: true },
              orderBy: { occurredAt: 'desc' },
            },
          },
        },
      },
    });
    const infractions = fleet.vehicles.flatMap((v) => v.infractions);
    const totalDue = infractions
      .filter((i) => !['PAID', 'CANCELLED', 'CLOSED', 'REJECTED'].includes(i.status))
      .reduce((sum, i) => sum + (i.amountDue ?? 0), 0);
    return { ...fleet, summary: { vehicleCount: fleet.vehicles.length, infractionCount: infractions.length, totalDue } };
  }

  @Post(':id/vehicles')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  assignVehicle(@Param('id') id: string, @Body() dto: AssignVehicleDto) {
    return this.prisma.vehicle.update({
      where: { id: dto.vehicleId },
      data: { fleetId: id },
    });
  }

  @Delete(':id/vehicles/:vehicleId')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  removeVehicle(@Param('vehicleId') vehicleId: string) {
    return this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { fleetId: null },
    });
  }
}
