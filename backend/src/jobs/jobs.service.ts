import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, JobStatus } from './job.entity';
import { CreateJobDto } from './dto';

// The single source of truth for legal transitions.
// pending -> running -> completed
//                     \-> failed
// completed/failed are terminal - nothing may leave them.
const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  [JobStatus.PENDING]: [JobStatus.RUNNING],
  [JobStatus.RUNNING]: [JobStatus.COMPLETED, JobStatus.FAILED],
  [JobStatus.COMPLETED]: [],
  [JobStatus.FAILED]: [],
};

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private readonly jobsRepository: Repository<Job>,
  ) {}

  async create(dto: CreateJobDto): Promise<Job> {
    const job = this.jobsRepository.create({
      title: dto.title,
      type: dto.type,
      status: JobStatus.PENDING,
    });
    return this.jobsRepository.save(job);
  }

  async findAll(): Promise<Job[]> {
    return this.jobsRepository.find({ order: { createdAt: 'DESC' } });
  }

  async remove(id: string): Promise<void> {
    const result = await this.jobsRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Job ${id} not found`);
    }
  }

  /**
   * Updates a job's status, enforcing the transition state machine AND
   * protecting against the two-tabs race condition.
   *
   * Race condition handling:
   * Rather than doing a "read job -> check status in JS -> write new status"
   * sequence (which has a TOCTOU gap: two concurrent requests can both read
   * "pending" before either writes "running"), we issue a single atomic
   * conditional UPDATE:
   *
   *   UPDATE jobs SET status = :next WHERE id = :id AND status = :expectedCurrent
   *
   * The database guarantees only one of two concurrent UPDATE statements
   * targeting the same row can succeed when their WHERE clauses are
   * mutually exclusive after the first one commits - the loser's WHERE
   * clause simply matches zero rows because the row's status has already
   * changed. This makes the check-then-act sequence atomic without needing
   * explicit row locks, application-level mutexes, or a job queue/broker.
   *
   * We try the UPDATE against every status that legally allows the
   * requested transition's target... actually simpler: we require the
   * caller to tell us nothing about "from" state; we look up the current
   * status once to decide which "from" statuses could legally reach the
   * target, then attempt the conditional update against the job's
   * observed current status. If the affected row count is 0, we re-fetch
   * to find out whether the job no longer exists, or whether another
   * request already moved it - and return a precise 409 either way.
   */
  async updateStatus(id: string, nextStatus: JobStatus): Promise<Job> {
    // First, read the job to give a clear 404 and to determine, for a
    // helpful error message, what its status is *right now*. This read
    // is NOT what enforces correctness (that's the atomic UPDATE below)
    // - it only produces good error messages if the fast path fails.
    const current = await this.jobsRepository.findOne({ where: { id } });
    if (!current) {
      throw new NotFoundException(`Job ${id} not found`);
    }

    const allowedFrom = current.status;
    if (!ALLOWED_TRANSITIONS[allowedFrom]?.includes(nextStatus)) {
      throw new UnprocessableEntityException(
        `Invalid transition: cannot move job from '${allowedFrom}' to '${nextStatus}'. ` +
          `Allowed next states from '${allowedFrom}': ${
            ALLOWED_TRANSITIONS[allowedFrom]?.length
              ? ALLOWED_TRANSITIONS[allowedFrom].join(', ')
              : 'none (terminal state)'
          }.`,
      );
    }

    // Atomic compare-and-swap: only succeeds if the row's status still
    // equals `allowedFrom` at the moment the UPDATE executes.
    const result = await this.jobsRepository
      .createQueryBuilder()
      .update(Job)
      .set({ status: nextStatus })
      .where('id = :id AND status = :expected', {
        id,
        expected: allowedFrom,
      })
      .execute();

    if (result.affected === 0) {
      // Someone else changed the status between our read and our write.
      const latest = await this.jobsRepository.findOne({ where: { id } });
      if (!latest) {
        throw new NotFoundException(`Job ${id} not found`);
      }
      throw new ConflictException(
        `Job status was changed concurrently by another request (now '${latest.status}'). ` +
          `Refresh and retry if the new state still allows your intended transition.`,
      );
    }

    return (await this.jobsRepository.findOne({ where: { id } })) as Job;
  }
}
