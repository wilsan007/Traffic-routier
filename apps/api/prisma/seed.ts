import { PrismaClient, Role, HotlistReason, Priority, InfractionSeverity, LicenseStatus, InsuranceStatus, CameraType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const region = await prisma.region.upsert({
    where: { code: 'GENERIC' },
    update: {},
    create: {
      code: 'GENERIC',
      name: 'Format générique configurable',
      plateFormatRegex: '^[A-Z0-9]{4,10}$',
      plateFormatHint: 'AA123AA',
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

  const vehicle1 = await prisma.vehicle.upsert({
    where: { plateNumber: 'AB123CD' },
    update: {},
    create: {
      plateNumber: 'AB123CD',
      regionId: region.id,
      make: 'Peugeot',
      model: '308',
      color: 'Gris',
      year: 2019,
      vin: 'VF3AB12CD34567890',
      insuranceStatus: InsuranceStatus.VALID,
      insuranceExpiresAt: new Date('2026-12-01'),
      technicalControlExpiresAt: new Date('2026-09-01'),
      ownerships: { create: { ownerId: owner1.id, startDate: new Date('2020-01-01') } },
    },
  });

  const vehicle2 = await prisma.vehicle.upsert({
    where: { plateNumber: 'XY987ZT' },
    update: {},
    create: {
      plateNumber: 'XY987ZT',
      regionId: region.id,
      make: 'Renault',
      model: 'Clio',
      color: 'Noir',
      year: 2021,
      vin: 'VF1XY98ZT98765432',
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
      plateNumber: 'XY987ZT',
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
