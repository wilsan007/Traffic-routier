import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('vehicles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('vehicles')
export class VehiclesController {
  constructor(private vehiclesService: VehiclesService) {}

  @Post()
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  create(@Body() dto: CreateVehicleDto) {
    return this.vehiclesService.create(dto);
  }

  @Get()
  findAll(@Query('q') q?: string) {
    return this.vehiclesService.findAll(q);
  }

  @Get('by-plate/:plate')
  findByPlate(@Param('plate') plate: string) {
    return this.vehiclesService.findByPlate(plate);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.vehiclesService.findOne(id);
  }

  @Get(':id/route')
  getRoute(@Param('id') id: string, @Query('hours') hours?: string) {
    return this.vehiclesService.getRoute(id, hours ? parseInt(hours, 10) : 24);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  update(@Param('id') id: string, @Body() dto: UpdateVehicleDto) {
    return this.vehiclesService.update(id, dto);
  }

  @Post(':id/transfer-ownership')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  transferOwnership(@Param('id') id: string, @Body() dto: TransferOwnershipDto) {
    return this.vehiclesService.transferOwnership(id, dto.newOwnerId);
  }
}
