import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Set the base path required by the task
  app.setGlobalPrefix('api/v1');

  // Enable automatic validation (for username lengths, etc.)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Apply our contract wrappers
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(3000);
  console.log(`🚀 API is live at http://localhost:3000/api/v1`);
}

// Fixed "Floating Promise" error
bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
