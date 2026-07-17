import { PrismaClient, Role, HotlistReason, Priority, InfractionSeverity, LicenseStatus, InsuranceStatus, CameraType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  // Format djiboutien — doit rester aligné sur apps/mobile/lib/djiboutiPlate.ts,
  // qui filtre côté terrain :
  //
  //   privé    123 D 45   1 à 3 chiffres, D intercalée, 1 à 3 chiffres
  //   officiel 1234 A     3 à 5 chiffres puis A, B ou C
  //   transit  3090 TT    3 à 5 chiffres puis TT
  //
  // La regex précédente (^[A-Z0-9]{4,10}$) acceptait n'importe quoi — « A7NORD »
  // lu sur un panneau d'autoroute passait pour une immatriculation.
  const region = await prisma.region.upsert({
    where: { code: 'DJ' },
    update: {},
    create: {
      code: 'DJ',
      name: 'Djibouti',
      plateFormatRegex: '^([1-9]\\d{0,2}D[1-9]\\d{0,2}|\\d{3,5}[ABC]|\\d{3,5}TT)$',
      plateFormatHint: '123 D 45',
    },
  });

  const adminPassword = await argon2.hash('Admin123!');
  const supervisorPassword = await argon2.hash('Supervisor123!');
  const officerPassword = await argon2.hash('Officer123!');

  const admin = await prisma.user.upsert({
    where: { email: 'admin@trafficguard.local' },
    update: {},
    create: {
      email: 'admin@trafficguard.local',
      passwordHash: adminPassword,
      firstName: 'Alice',
      lastName: 'Admin',
      role: Role.ADMIN,
      badgeNumber: 'ADM-0001',
    },
  });

  const supervisor = await prisma.user.upsert({
    where: { email: 'superviseur@trafficguard.local' },
    update: {},
    create: {
      email: 'superviseur@trafficguard.local',
      passwordHash: supervisorPassword,
      firstName: 'Sophie',
      lastName: 'Superviseur',
      role: Role.SUPERVISOR,
      badgeNumber: 'SUP-0001',
    },
  });

  const officer = await prisma.user.upsert({
    where: { email: 'agent@trafficguard.local' },
    update: {},
    create: {
      email: 'agent@trafficguard.local',
      passwordHash: officerPassword,
      firstName: 'Omar',
      lastName: 'Officier',
      role: Role.OFFICER,
      badgeNumber: 'OFC-0042',
    },
  });

  const camera = await prisma.camera.upsert({
    where: { id: 'seed-camera-1' },
    update: {},
    create: {
      id: 'seed-camera-1',
      name: 'Portique Autoroute A1 - PK 12',
      type: CameraType.FIXED,
      regionId: region.id,
      latitude: 48.8566,
      longitude: 2.3522,
    },
  });

  const owner1 = await prisma.owner.upsert({
    where: { nationalId: 'NID-000001' },
    update: {},
    create: {
      firstName: 'Jean',
      lastName: 'Dupont',
      nationalId: 'NID-000001',
      address: '12 rue de la République',
      phone: '+33612345678',
      licenseNumber: 'LIC-000001',
      licenseStatus: LicenseStatus.VALID,
      licenseExpiresAt: new Date('2028-01-01'),
    },
  });

  const owner2 = await prisma.owner.upsert({
    where: { nationalId: 'NID-000002' },
    update: {},
    create: {
      firstName: 'Marie',
      lastName: 'Martin',
      nationalId: 'NID-000002',
      address: '5 avenue des Fleurs',
      phone: '+33698765432',
      licenseNumber: 'LIC-000002',
      licenseStatus: LicenseStatus.SUSPENDED,
      licenseExpiresAt: new Date('2026-05-01'),
    },
  });

  // Les deux véhicules portent des plaques RÉELLES, photographiées à Djibouti et
  // conservées dans tools/plate-dataset. Elles couvrent les deux polices en
  // service : « 252 D 105 » est gravée en police standard, « 724 D 53 » en
  // 7 segments. Viser ces plaques permet donc d'éprouver la chaîne complète —
  // OCR, format, consensus, correspondance véhicule, alerte hotlist — sur de
  // vraies images plutôt que sur des numéros inventés.
  const vehicle1 = await prisma.vehicle.upsert({
    where: { plateNumber: '252D105' },
    update: {},
    create: {
      plateNumber: '252D105',
      regionId: region.id,
      make: 'Toyota',
      model: 'Land Cruiser',
      color: 'Blanc',
      year: 2019,
      vin: 'JTEBU29J2K5252105',
      insuranceStatus: InsuranceStatus.VALID,
      insuranceExpiresAt: new Date('2026-12-01'),
      technicalControlExpiresAt: new Date('2026-09-01'),
      ownerships: { create: { ownerId: owner1.id, startDate: new Date('2020-01-01') } },
    },
  });

  const vehicle2 = await prisma.vehicle.upsert({
    where: { plateNumber: '724D53' },
    update: {},
    create: {
      plateNumber: '724D53',
      regionId: region.id,
      make: 'Toyota',
      model: 'Hilux',
      color: 'Gris',
      year: 2021,
      vin: 'MR0FZ29G4M0724053',
      insuranceStatus: InsuranceStatus.EXPIRED,
      insuranceExpiresAt: new Date('2025-01-01'),
      stolen: true,
      ownerships: { create: { ownerId: owner2.id, startDate: new Date('2021-06-01') } },
    },
  });

  await prisma.hotlistEntry.upsert({
    where: { id: 'seed-hotlist-1' },
    update: {},
    create: {
      id: 'seed-hotlist-1',
      plateNumber: '724D53',
      reason: HotlistReason.STOLEN_VEHICLE,
      priority: Priority.CRITICAL,
      notes: 'Véhicule signalé volé le 2026-06-20.',
      createdById: supervisor.id,
    },
  });

  await prisma.infraction.create({
    data: {
      vehicleId: vehicle1.id,
      ownerId: owner1.id,
      officerId: officer.id,
      type: 'Excès de vitesse',
      description: '20 km/h au-dessus de la limite autorisée',
      severity: InfractionSeverity.MAJOR,
      fineAmount: 135,
      points: 1,
      occurredAt: new Date('2026-06-15'),
    },
  });

  console.log('Seed terminé.');
  console.log('Comptes de démonstration :');
  console.log('  admin@trafficguard.local / Admin123!');
  console.log('  superviseur@trafficguard.local / Supervisor123!');
  console.log('  agent@trafficguard.local / Officer123!');
  console.log(`Caméra: ${camera.name}, Véhicules: ${vehicle1.plateNumber}, ${vehicle2.plateNumber}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
