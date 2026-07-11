import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { PaymentMethod } from '@prisma/client';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { InfractionsService } from '../infractions/infractions.service';
import { PvPdfService } from '../infractions/pv-pdf.service';
import { AuditService } from '../common/audit/audit.service';

class PublicPayDto {
  @IsString()
  plate: string;

  @IsString()
  cardNumber: string; // simulé — jamais stocké

  @IsString()
  cardHolder: string;
}

class PublicDisputeDto {
  @IsString()
  plate: string;

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsEmail()
  contactEmail?: string;
}

// Portail citoyen : accès public SANS authentification, sécurisé par le couple
// référence du PV + plaque d'immatriculation (comme les portails officiels).
// Ne renvoie que les données strictement nécessaires au titulaire.
//
// NOTE SÉCURITÉ : la référence (PV-AAAA-NNNNNN) est générée de façon
// séquentielle (voir InfractionsService.nextReference) et la plaque n'est pas
// un secret (visible sur le véhicule). Le couple référence+plaque est donc
// énumérable. Le throttling ci-dessous ralentit une énumération automatisée
// mais ne l'empêche pas structurellement — une correction complète (rendre la
// référence non séquentielle, ex. suffixe aléatoire) est un choix produit
// (impacte le format du PV déjà imprimé/notifié) et n'a pas été fait ici.
@Throttle({ medium: { limit: 8, ttl: 10000 }, long: { limit: 20, ttl: 60000 } })
@ApiTags('public')
@Controller('public/infractions')
export class PublicPortalController {
  constructor(
    private prisma: PrismaService,
    private infractionsService: InfractionsService,
    private pvPdfService: PvPdfService,
    private audit: AuditService,
  ) {}

  private async findByReferenceAndPlate(reference: string, plate: string) {
    const normalized = plate.toUpperCase().replace(/\s+/g, '');
    const infraction = await this.prisma.infraction.findUnique({
      where: { reference },
      include: {
        vehicle: true,
        infractionType: true,
        payments: { orderBy: { createdAt: 'desc' } },
        dispute: true,
      },
    });
    if (!infraction || infraction.vehicle.plateNumber !== normalized) {
      // Message identique dans les deux cas pour ne pas révéler l'existence d'un PV
      throw new NotFoundException('Aucune contravention trouvée pour cette référence et cette plaque.');
    }
    return infraction;
  }

  @Get(':reference')
  async lookup(@Param('reference') reference: string, @Query('plate') plate: string) {
    if (!plate) throw new BadRequestException('Plaque requise');
    const i = await this.findByReferenceAndPlate(reference, plate);
    await this.audit.log({
      action: 'PUBLIC_PV_LOOKUP',
      entityType: 'Infraction',
      entityId: i.id,
    });
    return {
      reference: i.reference,
      status: i.status,
      type: i.type,
      description: i.description,
      occurredAt: i.occurredAt,
      plate: i.vehicle.plateNumber,
      vehicle: [i.vehicle.make, i.vehicle.model].filter(Boolean).join(' '),
      fineAmount: i.fineAmount,
      amountDue: i.amountDue,
      dueDate: i.dueDate,
      notifiedAt: i.notifiedAt,
      payments: i.payments.map((p) => ({
        amount: p.amount,
        method: p.method,
        receiptNumber: p.receiptNumber,
        createdAt: p.createdAt,
      })),
      dispute: i.dispute
        ? { status: i.dispute.status, decision: i.dispute.decision, createdAt: i.dispute.createdAt }
        : null,
    };
  }

  @Get(':reference/pdf')
  async pdf(
    @Param('reference') reference: string,
    @Query('plate') plate: string,
    @Res() res: Response,
  ) {
    const i = await this.findByReferenceAndPlate(reference, plate);
    const full = await this.infractionsService.findOne(i.id);
    const owner = full.owner ?? full.vehicle.ownerships?.[0]?.owner ?? null;
    const buffer = await this.pvPdfService.generate({
      reference: full.reference ?? full.id,
      status: full.status,
      occurredAt: full.occurredAt,
      label: full.type,
      description: full.description,
      fineAmount: full.fineAmount,
      amountDue: full.amountDue,
      points: full.points,
      dueDate: full.dueDate,
      plate: full.vehicle.plateNumber,
      vehicleLabel: [full.vehicle.make, full.vehicle.model].filter(Boolean).join(' '),
      ownerName: owner ? `${owner.firstName} ${owner.lastName}` : null,
      ownerAddress: owner?.address,
      officerName: `${full.officer.firstName} ${full.officer.lastName}`,
      officerBadge: full.officer.badgeNumber,
      validatedByName: null,
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${full.reference}.pdf"`,
    });
    res.send(buffer);
  }

  // Paiement en ligne simulé : la "carte" n'est ni vérifiée ni stockée —
  // seul le dernier chiffre conditionne l'échec (0 = refusé) pour la démo.
  @Post(':reference/pay')
  async pay(@Param('reference') reference: string, @Body() dto: PublicPayDto) {
    const i = await this.findByReferenceAndPlate(reference, dto.plate);
    const digits = dto.cardNumber.replace(/\D/g, '');
    if (digits.length < 12) throw new BadRequestException('Numéro de carte invalide');
    if (digits.endsWith('0')) {
      throw new BadRequestException('Paiement refusé par la banque (simulation)');
    }
    const payment = await this.infractionsService.recordPayment(i.id, {
      method: PaymentMethod.CARD_ONLINE,
      payerName: dto.cardHolder,
    });
    return {
      receiptNumber: payment.receiptNumber,
      amount: payment.amount,
      paidAt: payment.createdAt,
    };
  }

  @Post(':reference/dispute')
  async dispute(@Param('reference') reference: string, @Body() dto: PublicDisputeDto) {
    const i = await this.findByReferenceAndPlate(reference, dto.plate);
    const created = await this.infractionsService.openDispute(i.id, {
      reason: dto.reason,
      details: dto.details,
      contactEmail: dto.contactEmail,
    });
    return { status: created.status, createdAt: created.createdAt };
  }
}
