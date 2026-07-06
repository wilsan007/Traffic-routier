import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';

// Envoi de notifications : email/courrier simulés (journalisés en base,
// prêts à brancher sur un vrai SMTP/prestataire courrier), et push mobile
// réel via l'API Expo.
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  async sendInfractionNotice(
    infractionId: string,
    recipient: string,
    details: {
      reference: string;
      plate: string;
      label: string;
      amountDue: number;
      reducedUntil: Date | null;
      dueDate: Date;
    },
  ) {
    const subject = `Avis de contravention ${details.reference}`;
    const body = [
      `Véhicule : ${details.plate}`,
      `Infraction : ${details.label}`,
      `Montant à régler : ${details.amountDue.toFixed(2)} €`,
      details.reducedUntil
        ? `Tarif minoré valable jusqu'au ${details.reducedUntil.toLocaleDateString('fr-FR')}`
        : null,
      `Échéance avant majoration : ${details.dueDate.toLocaleDateString('fr-FR')}`,
      `Payez ou contestez en ligne sur le portail citoyen avec la référence ${details.reference} et votre plaque.`,
    ]
      .filter(Boolean)
      .join('\n');

    await this.prisma.notificationLog.create({
      data: { infractionId, channel: 'EMAIL', recipient, subject, body },
    });
    this.logger.log(`[EMAIL simulé] à ${recipient} — ${subject}`);
  }

  // Push mobile via Expo (jetons enregistrés sur les comptes agents)
  async pushToUsers(userIds: string[], title: string, message: string) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, expoPushToken: { not: null } },
      select: { expoPushToken: true },
    });
    const messages = users.map((u) => ({
      to: u.expoPushToken,
      title,
      body: message,
      sound: 'default',
    }));
    if (messages.length === 0) return { sent: 0 };
    try {
      await axios.post('https://exp.host/--/api/v2/push/send', messages, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10_000,
      });
      return { sent: messages.length };
    } catch (error) {
      this.logger.warn(`Échec push Expo: ${(error as Error).message}`);
      return { sent: 0 };
    }
  }

  async pushToAllOfficers(title: string, message: string) {
    const officers = await this.prisma.user.findMany({
      where: { active: true, expoPushToken: { not: null } },
      select: { id: true },
    });
    return this.pushToUsers(
      officers.map((o) => o.id),
      title,
      message,
    );
  }
}
