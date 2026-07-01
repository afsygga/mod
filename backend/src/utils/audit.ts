import { db } from '../database/db';

/**
 * Record an admin/settings mutation into the admin_audit table.
 * Never throws — audit logging must never break the caller.
 */
export async function recordAudit(adminEmail: string, action: string, detail?: string): Promise<void> {
  try {
    await db.query(
      'INSERT INTO admin_audit (admin_email, action, detail) VALUES ($1, $2, $3)',
      [adminEmail, action, detail ?? null]
    );
  } catch (err) {
    // Swallow — auditing is best-effort.
    console.error('[audit] failed to record', action, err);
  }
}
