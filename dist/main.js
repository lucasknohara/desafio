import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { correlationIdMiddleware } from './infrastructure/observability/correlation-id.middleware.js';
import { AppModule } from './app.module.js';
const app = await NestFactory.create(AppModule);
app.use(correlationIdMiddleware);
app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: true,
}));
app.enableShutdownHooks();
const port = Number(process.env.PORT ?? 3000);
await app.listen(port, '0.0.0.0');
process.stdout.write(`Jungle Gaming API listening on port ${port}\n`);
//# sourceMappingURL=main.js.map