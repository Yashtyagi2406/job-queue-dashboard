import 'reflect-metadata';
import * as http from 'http';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            // strip unknown fields
      forbidNonWhitelisted: true, // reject requests containing unknown fields
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Job Queue API listening on port ${port}`);

  // Keep-alive: Render's free tier idles after 15 min of inactivity.
  // Ping our own /health endpoint every 14 min so the process stays warm.
  // Only runs in production (RENDER env var is set automatically by Render).
  if (process.env.RENDER) {
    const INTERVAL_MS = 14 * 60 * 1000; // 14 minutes
    setInterval(() => {
      http.get(`http://localhost:${port}/health`, (res) => {
        // eslint-disable-next-line no-console
        console.log(`[keep-alive] ping → ${res.statusCode}`);
      }).on('error', (err) => {
        // eslint-disable-next-line no-console
        console.error(`[keep-alive] ping failed: ${err.message}`);
      });
    }, INTERVAL_MS);
  }
}
bootstrap();
