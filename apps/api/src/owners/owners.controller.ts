import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { OwnersService } from './owners.service';
import { CreateOwnerDto } from './dto/create-owner.dto';
import { UpdateOwnerDto } from './dto/update-owner.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('owners')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('owners')
export class OwnersController {
  constructor(private ownersService: OwnersService) {}

  @Post()
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  create(@Body() dto: CreateOwnerDto) {
    return this.ownersService.create(dto);
  }

  @Get()
  findAll(@Query('q') q?: string) {
    return this.ownersService.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ownersService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  update(@Param('id') id: string, @Body() dto: UpdateOwnerDto) {
    return this.ownersService.update(id, dto);
  }
}
