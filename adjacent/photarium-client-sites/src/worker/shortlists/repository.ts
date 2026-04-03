import type { ShortlistSubmissionRecord } from './types';

/**
 * D1 persistence for client shortlist submissions.
 */
export class ShortlistRepository {
  constructor(private readonly database: D1Database) {}

  async insert(record: ShortlistSubmissionRecord): Promise<void> {
    await this.database
      .prepare(
        `
          INSERT INTO shortlist_submissions (
            id, project_id, client_session_id, selected_asset_ids_json, client_name, client_email, note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .bind(
        record.id,
        record.projectId,
        record.clientSessionId,
        JSON.stringify(record.selectedAssetIds),
        record.clientName ?? null,
        record.clientEmail ?? null,
        record.note ?? null,
        record.createdAt
      )
      .run();
  }
}
