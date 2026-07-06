import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { RegionsService } from './regions.service';
import { CreateRegionDto } from './dto/create-region.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@ApiTags('regions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('regions')
export class RegionsController {
  constructor(private regionsService: RegionsService) {}

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() dto: CreateRegionDto) {
    return this.regionsService.create(dto);
  }

  @Get()
  findAll() {
    return this.regionsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.regionsService.findOne(id);
  }
}
