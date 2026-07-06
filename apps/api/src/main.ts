import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

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
bootstrap();
