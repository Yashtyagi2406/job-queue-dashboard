import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  VersionColumn,
} from 'typeorm';

export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column()
  type: string;

  @Column({
    type: 'varchar',
    default: JobStatus.PENDING,
  })
  status: JobStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Used internally for optimistic-concurrency style debugging/audit.
  // The actual race-condition fix uses an atomic conditional UPDATE
  // (see JobsService.updateStatus), not this column - but keeping a
  // version counter is a cheap extra signal for future debugging/audit.
  @VersionColumn({ name: 'version', default: 1 })
  version: number;
}
