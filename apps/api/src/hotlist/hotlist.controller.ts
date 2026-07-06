import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { HotlistService } from './hotlist.service';
import { CreateHotlistEntryDto } from './dto/create-hotlist-entry.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('hotlist')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('hotlist')
export class HotlistController {
  constructor(private hotlistService: HotlistService) {}

  @Post()
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  create(@Body() dto: CreateHotlistEntryDto, @CurrentUser() user: { userId: string }) {
    return this.hotlistService.create(dto, user.userId);
  }

  @Get()
  findAll(@Query('activeOnly') activeOnly?: string) {
    return this.hotlistService.findAll(activeOnly === 'true');
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.hotlistService.findOne(id);
  }

  @Patch(':id/deactivate')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  deactivate(@Param('id') id: string) {
    return this.hotlistService.deactivate(id);
  }
}
