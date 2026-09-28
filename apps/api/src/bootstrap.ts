import helmet from '@fastify/helmet';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export async function configureApplication(
  app: NestFastifyApplication,
  origins: string[],
): Promise<void> {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      validationError: { target: false, value: false },
    }),
  );
  await app.register(helmet);
  app.enableCors({ origin: origins.length ? origins : false, credentials: false });
  app.enableShutdownHooks();
}
