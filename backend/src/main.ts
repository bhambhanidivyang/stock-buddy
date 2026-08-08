import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function corsOrigins(): string[] {
  const fromEnv = (process.env.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    ...fromEnv,
  ];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const allowed = corsOrigins();
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Non-browser clients (curl, server-to-server) send no Origin.
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
