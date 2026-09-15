import { IsEnum, IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { JobStatus } from './job.entity';

const JOB_TYPES = ['email', 'report', 'data-sync', 'image-processing', 'other'];

export class CreateJobDto {
  @IsString()
  @IsNotEmpty({ message: 'title must not be empty' })
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty({ message: 'type must not be empty' })
  @IsIn(JOB_TYPES, {
    message: `type must be one of: ${JOB_TYPES.join(', ')}`,
  })
  type: string;
}

export class UpdateJobStatusDto {
  @IsEnum(JobStatus, {
    message: `status must be one of: ${Object.values(JobStatus).join(', ')}`,
  })
  status: JobStatus;
}

