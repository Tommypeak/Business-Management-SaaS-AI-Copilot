import 'reflect-metadata';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';
import type { Environment } from './config/environment.js';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1024 * 1024, trustProxy: false }),
    { logger: new ConsoleLogger({ json: true }), abortOnError: false },
  );
  try {
    const config = app.get(ConfigService<Environment, true>);
    await configureApplication(app, config.get('API_CORS_ORIGINS', { infer: true }));
    if (config.get('NODE_ENV', { infer: true }) === 'development') {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('Business Management API')
          .setVersion('1')
          .addBearerAuth()
          .build(),
      );
      SwaggerModule.setup('api/docs', app, document);
    }
    await app.listen(
      config.get('API_PORT', { infer: true }),
      config.get('API_HOST', { infer: true }),
    );
  } catch (error) {
    await app.close();
    throw error;
  }
}

bootstrap().catch(() => {
  // Connection errors may contain credentials; never dump raw startup errors.
  console.error(
    JSON.stringify({
      level: 'error',
      message: 'API startup failed. Check configuration and infrastructure availability.',
    }),
  );
  process.exitCode = 1;
});
