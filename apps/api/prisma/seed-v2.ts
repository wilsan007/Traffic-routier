import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const INFRACTION_TYPES = [
  { code: 'VITESSE_20', label: 'Excès de vitesse < 20 km/h', category: 'Vitesse', baseAmount: 68, reducedAmount: 45, increasedAmount: 180, points: 1 },
  { code: 'VITESSE_20_50', label: 'Excès de vitesse 20 à 50 km/h', category: 'Vitesse', baseAmount: 135, reducedAmount: 90, increasedAmount: 375, points: 2 },
  { code: 'VITESSE_50_PLUS', label: 'Excès de vitesse > 50 km/h', category: 'Vitesse', baseAmount: 1500, reducedAmount: null, increasedAmount: 3000, points: 6 },
  { code: 'FEU_ROUGE', label: 'Franchissement de feu rouge', category: 'Signalisation', baseAmount: 135, reducedAmount: 90, increasedAmount: 375, points: 4 },
  { code: 'STOP', label: 'Non-respect du stop', category: 'Signalisation', baseAmount: 135, reducedAmount: 90, increasedAmount: 375, points: 4 },
  { code: 'STATIONNEMENT', label: 'Stationnement gênant', category: 'Stationnement', baseAmount: 35, reducedAmount: 22, increasedAmount: 75, points: 0 },
  { code: 'STATIONNEMENT_DANGEREUX', label: 'Stationnement dangereux', category: 'Stationnement', baseAmount: 135, reducedAmount: 90, increasedAmount: 375, points: 3 },
  { code: 'TELEPHONE', label: 'Téléphone tenu en main', category: 'Comportement', baseAmount: 135, reducedAmount: 90, increasedAmount: 375, points: 3 },
  { code: 'CEINTURE', label: 'Défaut de port de ceinture', category: 'Comportement', baseAmount: 135, reducedAmount: 90, increasedAmount: 375, points: 3 },
  { code: 'ASSURANCE', label: 'Défaut d’assurance', category: 'Documents', baseAmount: 500, reducedAmount: 400, increasedAmount: 1000, points: 0 },
  { code: 'CT_EXPIRE', label: 'Contrôle technique expiré', category: 'Documents', baseAmount: 135, reducedAmount: 90, increasedAmount: 375, points: 0 },
];

async function main() {
  for (const t of INFRACTION_TYPES) {
    await prisma.infractionType.upsert({
      where: { code: t.code },
      update: { ...t, reducedAmount: t.reducedAmount ?? undefined },
      create: { ...t, reducedAmount: t.reducedAmount ?? undefined },
    });
  }
  console.log(`Barème : ${INFRACTION_TYPES.length} types d'infraction`);

  const fleet = await prisma.fleet.upsert({
    where: { name: 'Taxis de la Ville' },
    update: {},
    create: { name: 'Taxis de la Ville', contactName: 'Karim Benali', contactEmail: 'flotte@taxis-ville.example' },
  });
  await prisma.vehicle.updateMany({
    where: { plateNumber: 'AB123CD' },
    data: { fleetId: fleet.id },
  });
  console.log('Flotte de démo créée (Peugeot 308 rattachée)');

  const camera = await prisma.camera.findFirst({ where: { id: 'seed-camera-1' } });
  const existingToll = await prisma.tollZone.findFirst({ where: { name: 'Péage Pont Nord' } });
  if (!existingToll) {
    await prisma.tollZone.create({
      data: {
        name: 'Péage Pont Nord',
        cameraId: camera?.id,
        latitude: 48.8666,
        longitude: 2.3333,
        radiusMeters: 250,
        pricePerPassage: 2.5,
      },
    });
  }
  console.log('Zone de péage créée (liée à la caméra du portique A1)');

  const zones = [
    { name: 'Commissariat central', latitude: 48.8566, longitude: 2.3522, radiusMeters: 400 },
    { name: 'École Jean-Moulin', latitude: 48.8606, longitude: 2.3376, radiusMeters: 300 },
  ];
  for (const z of zones) {
    const exists = await prisma.sensitiveZone.findFirst({ where: { name: z.name } });
    if (!exists) await prisma.sensitiveZone.create({ data: z });
  }
  console.log('Zones sensibles créées');

  console.log('Seed v2 terminé.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
