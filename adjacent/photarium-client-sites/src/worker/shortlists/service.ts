import { clientShortlistSubmissionSchema } from '../publishing-contract/schema';
import type { ClientShortlistSubmission } from '../publishing-contract/types';
import { ShortlistRepository } from './repository';
import type { ShortlistSubmissionRecord } from './types';

/**
 * Validation and persistence for shortlist submissions.
 */
export class ShortlistService {
  constructor(private readonly repository: ShortlistRepository) {}

  parseSubmission(input: unknown): ClientShortlistSubmission {
    return clientShortlistSubmissionSchema.parse(input);
  }

  async saveSubmission(projectId: string, submission: ClientShortlistSubmission): Promise<ShortlistSubmissionRecord> {
    const record: ShortlistSubmissionRecord = {
      ...submission,
      id: crypto.randomUUID(),
      projectId,
      createdAt: new Date().toISOString(),
    };

    await this.repository.insert(record);
    return record;
  }
}
