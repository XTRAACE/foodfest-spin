import type { Queryable } from '../db/index.js';

export interface AuditEntry {
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

/** Appends an entry to the audit log. Never throws into the caller's flow. */
export async function logAudit(q: Queryable, entry: AuditEntry): Promise<void> {
  await q.query(
    `insert into audit_logs (actor, action, entity, entity_id, details)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [
      entry.actor,
      entry.action,
      entry.entity,
      entry.entityId ?? null,
      JSON.stringify(entry.details ?? {}),
    ],
  );
}
