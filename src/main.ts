import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.use(helmet());
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new PrismaExceptionFilter());
  const origins = (config.get<string>('CORS_ORIGINS') ?? '').split(',').map((v) => v.trim()).filter(Boolean);
  if (origins.length > 0) app.enableCors({ origin: origins });
  const document = new DocumentBuilder().setTitle('Sistema Motos API').setDescription('API local de gestión comercial y operativa. El porcentaje por marca es una regla comercial comunicada, no una clasificación fiscal verificada.').setVersion('1.0.0').build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, document), { useGlobalPrefix: true });
  await app.listen(config.get<number>('PORT', 3000), config.get<string>('HOST', '127.0.0.1'));
}
void bootstrap();
