import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

// Secrets par défaut présents dans le code (fallback dev) et dans
// .env.example : s'ils se retrouvent dans un environnement réel, n'importe
// qui ayant lu le dépôt public peut forger des jetons JWT ou usurper le
// service ML. On refuse de démarrer en production avec l'une de ces valeurs,
// et on avertit systématiquement sinon (dev/local).
const KNOWN_WEAK_SECRETS = new Set([
  'change-me-super-secret-in-prod',
  'change-me-refresh-secret',
  'change-me-refresh-secret-in-prod',
  'dev-service-key',
  'dev-service-key-change-in-prod',
  'change-me',
  'change-me-in-prod',
]);

function checkSecret(
  logger: Logger,
  name: string,
  value: string | undefined,
  isProd: boolean,
  requireSet: boolean,
) {
  if (!value) {
    // Absent : autorisé pour JWT_REFRESH_SECRET (repli intentionnel sur
    // JWT_SECRET, vérifié séparément) mais pas pour les autres.
    if (!requireSet) return;
  }
  const weak = !value || value.length < 16 || KNOWN_WEAK_SECRETS.has(value);
  if (!weak) return;
  const message = `${name} utilise une valeur par défaut/faible ou absente. Générez une valeur aléatoire forte (≥ 16 caractères) avant tout déploiement réel.`;
  if (isProd) {
    throw new Error(`Refus de démarrage (NODE_ENV=production) : ${message}`);
  }
  logger.warn(`[SECURITE] ${message}`);
}

function assertSecureSecrets() {
  const logger = new Logger('SecurityBootstrap');
  const isProd = process.env.NODE_ENV === 'production';
  checkSecret(logger, 'JWT_SECRET', process.env.JWT_SECRET, isProd, true);
  checkSecret(logger, 'JWT_REFRESH_SECRET', process.env.JWT_REFRESH_SECRET, isProd, false);
  checkSecret(logger, 'SERVICE_API_KEY', process.env.SERVICE_API_KEY, isProd, true);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Exécuté après NestFactory.create() : c'est ConfigModule (chargé au sein
  // d'AppModule) qui peuple process.env depuis le fichier .env via dotenv en
  // dehors de Docker. En conteneur, docker-compose (env_file) peuple déjà
  // process.env avant même le démarrage de Node, donc les deux cas sont
  // couverts en vérifiant ici plutôt qu'avant NestFactory.create().
  assertSecureSecrets();

  app.useLogger(app.get(PinoLogger));

  const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:4000,http://localhost:4001,http://localhost:4002')
    .split(',')
    .map((o) => o.trim());

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    credentials: true,
  });

  if (process.env.NODE_ENV === 'production') {
    app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  } else {
    app.use(
      helmet({
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        contentSecurityPolicy: false,
      }),
    );
  }
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('TrafficGuard API')
    .setDescription(
      'API de gestion du trafic routier : ALPR, véhicules, infractions, hotlist, alertes, dossiers, audit.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
  new Logger('Bootstrap').log(`TrafficGuard API listening on port ${port}`);
}
bootstrap().catch((err) => {
  new Logger('Bootstrap').error(`Échec du démarrage : ${err.message}`);
  process.exit(1);
});
