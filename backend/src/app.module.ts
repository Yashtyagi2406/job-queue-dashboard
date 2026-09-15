import { Controller, Get, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from './jobs/jobs.module';
import { Job } from './jobs/job.entity';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: process.env.DB_PATH || 'job-queue.sqlite',
      entities: [Job],
      synchronize: true, // fine for this small assignment; would use migrations in production
    }),
    JobsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
