import { Injectable } from '@nestjs/common';
import PDFDocument = require('pdfkit');

export interface PvPdfData {
  reference: string;
  status: string;
  occurredAt: Date;
  label: string;
  description?: string | null;
  fineAmount?: number | null;
  amountDue?: number | null;
  points?: number | null;
  dueDate?: Date | null;
  plate: string;
  vehicleLabel: string;
  ownerName?: string | null;
  ownerAddress?: string | null;
  officerName: string;
  officerBadge?: string | null;
  validatedByName?: string | null;
  location?: string | null;
}

// Génération du procès-verbal officiel en PDF
@Injectable()
export class PvPdfService {
  generate(data: PvPdfData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const fmtDate = (d: Date) =>
        new Date(d).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

      // En-tête
      doc
        .fontSize(10)
        .fillColor('#64748b')
        .text('RÉPUBLIQUE — FORCES DE L’ORDRE', { align: 'center' })
        .moveDown(0.2)
        .fontSize(18)
        .fillColor('#0f1f4a')
        .font('Helvetica-Bold')
        .text('PROCÈS-VERBAL DE CONTRAVENTION', { align: 'center' })
        .moveDown(0.3)
        .fontSize(12)
        .fillColor('#2f5fdb')
        .text(data.reference, { align: 'center' })
        .moveDown(1);

      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke().moveDown(1);

      const section = (title: string) => {
        doc
          .font('Helvetica-Bold')
          .fontSize(11)
          .fillColor('#0f1f4a')
          .text(title.toUpperCase())
          .moveDown(0.4);
      };
      const field = (label: string, value: string) => {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('#64748b')
          .text(`${label} : `, { continued: true })
          .fillColor('#0f172a')
          .font('Helvetica-Bold')
          .text(value);
      };

      section('Infraction');
      field('Nature', data.label);
      if (data.description) field('Détails', data.description);
      field('Date et heure des faits', fmtDate(data.occurredAt));
      if (data.location) field('Lieu', data.location);
      field('Statut du dossier', data.status);
      doc.moveDown(0.8);

      section('Véhicule');
      field('Immatriculation', data.plate);
      field('Véhicule', data.vehicleLabel);
      if (data.ownerName) field('Titulaire', data.ownerName);
      if (data.ownerAddress) field('Adresse', data.ownerAddress);
      doc.moveDown(0.8);

      section('Sanction');
      if (data.fineAmount != null) field('Amende forfaitaire', `${data.fineAmount.toFixed(2)} €`);
      if (data.amountDue != null) field('Montant exigible', `${data.amountDue.toFixed(2)} €`);
      if (data.points) field('Retrait de points', String(data.points));
      if (data.dueDate) field('À régler avant le', fmtDate(data.dueDate));
      doc.moveDown(0.8);

      section('Agent verbalisateur');
      field('Agent', data.officerName + (data.officerBadge ? ` (matricule ${data.officerBadge})` : ''));
      if (data.validatedByName) field('Validé par', data.validatedByName);
      doc.moveDown(1.5);

      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#94a3b8')
        .text(
          `Vous pouvez régler ou contester cette contravention en ligne sur le portail citoyen, muni de la référence ${data.reference} et du numéro d'immatriculation. Document généré le ${fmtDate(new Date())}.`,
          { align: 'justify' },
        );

      doc.end();
    });
  }
}
