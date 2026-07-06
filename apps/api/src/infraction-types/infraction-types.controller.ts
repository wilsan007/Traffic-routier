import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { InfractionTypesService } from './infraction-types.service';
import { CreateInfractionTypeDto } from './dto/create-infraction-type.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('infraction-types')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('infraction-types')
export class InfractionTypesController {
  constructor(private service: InfractionTypesService) {}

  @Post()
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  create(@Body() dto: CreateInfractionTypeDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query('activeOnly') activeOnly?: string) {
    return this.service.findAll(activeOnly === 'true');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  update(@Param('id') id: string, @Body() dto: Partial<CreateInfractionTypeDto>) {
    return this.service.update(id, dto);
  }

  @Patch(':id/deactivate')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  deactivate(@Param('id') id: string) {
    return this.service.deactivate(id);
  }
}
