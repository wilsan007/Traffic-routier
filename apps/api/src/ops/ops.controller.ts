import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { OpsGateway } from './ops.gateway';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

class UpdateLocationDto {
  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsOptional()
  @IsNumber()
  heading?: number;

  @IsOptional()
  @IsBoolean()
  onDuty?: boolean;
}

class SendMessageDto {
  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  toId?: string; // null = canal général (centre de commandement)
}

class RegisterPushTokenDto {
  @IsString()
  token: string;
}

@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ops')
export class OpsController {
  constructor(
    private prisma: PrismaService,
    private gateway: OpsGateway,
  ) {}

  // --- Géolocalisation des agents ---

  @Post('location')
  async updateLocation(@Body() dto: UpdateLocationDto, @CurrentUser() user: { userId: string }) {
    const location = await this.prisma.agentLocation.upsert({
      where: { userId: user.userId },
      create: { userId: user.userId, ...dto },
      update: dto,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, role: true } },
      },
    });
    this.gateway.emitAgentLocation(location);
    return location;
  }

  @Get('locations')
  locations() {
    // Positions rafraîchies dans les 15 dernières minutes uniquement
    const since = new Date(Date.now() - 15 * 60_000);
    return this.prisma.agentLocation.findMany({
      where: { onDuty: true, updatedAt: { gte: since } },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, role: true } },
      },
    });
  }

  // --- Messagerie agent <-> centre ---

  @Post('messages')
  async sendMessage(@Body() dto: SendMessageDto, @CurrentUser() user: { userId: string }) {
    const message = await this.prisma.message.create({
      data: { fromId: user.userId, toId: dto.toId, content: dto.content },
      include: {
        from: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, role: true } },
        to: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    this.gateway.emitMessage(message);
    return message;
  }

  @Get('messages')
  messages(@Query('withUserId') withUserId?: string, @CurrentUser() user?: { userId: string }) {
    // Canal général (toId null) + conversations impliquant l'utilisateur
    return this.prisma.message.findMany({
      where: withUserId
        ? {
            OR: [
              { fromId: user!.userId, toId: withUserId },
              { fromId: withUserId, toId: user!.userId },
            ],
          }
        : { OR: [{ toId: null }, { toId: user!.userId }, { fromId: user!.userId }] },
      include: {
        from: { select: { id: true, firstName: true, lastName: true, badgeNumber: true, role: true } },
        to: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @Patch('messages/:id/read')
  async markRead(@Param('id') id: string, @CurrentUser() user: { userId: string }) {
    // N'autorise que le destinataire (ou l'expéditeur, pour un accusé sur le
    // canal général) à marquer le message comme lu — évite qu'un utilisateur
    // quelconque altère l'état de lecture d'une conversation qui ne le
    // concerne pas en devinant/énumérant des identifiants de message.
    const message = await this.prisma.message.findUnique({ where: { id } });
    if (!message) throw new NotFoundException('Message introuvable');
    const isRecipient = message.toId === user.userId || message.toId === null;
    const isSender = message.fromId === user.userId;
    if (!isRecipient && !isSender) {
      throw new ForbiddenException("Vous n'êtes pas destinataire de ce message");
    }
    return this.prisma.message.update({ where: { id }, data: { readAt: new Date() } });
  }

  // --- Enregistrement du jeton push mobile ---

  @Post('push-token')
  registerPushToken(@Body() dto: RegisterPushTokenDto, @CurrentUser() user: { userId: string }) {
    return this.prisma.user.update({
      where: { id: user.userId },
      data: { expoPushToken: dto.token },
      select: { id: true },
    });
  }
}
