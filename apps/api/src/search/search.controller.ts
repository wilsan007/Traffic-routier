import { Controller, Get, Ip, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { SearchService } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('search')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('search')
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Get()
  search(@Query() dto: SearchQueryDto, @CurrentUser() user: { userId: string }, @Ip() ip: string) {
    return this.searchService.search(dto.q, dto.type, user.userId, ip);
  }

  @Get('history')
  @Roles(Role.ADMIN, Role.SUPERVISOR)
  history(@Query('userId') userId?: string) {
    return this.searchService.searchHistory(userId);
  }
}
