import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JobsModule } from './jobs/jobs.module';
import { Job } from './jobs/job.entity';

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
})
export class AppModule {}
