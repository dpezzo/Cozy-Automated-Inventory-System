/* eslint-disable no-console */
// One-time data fix: before this feature shipped, pushBatchToMiva
// (src/miva/mivaApiPush.ts) recorded API_PUSH_SUCCEEDED/FAILED/PARTIAL_FAILURE
// outcomes only in the Activity Log (audit_log), never on batch.import_status
// itself -- the user had to click "Mark IMPORT_REPORTED"/"Mark IMPORT_FAILED"
// by hand afterward. This walks the existing audit_log history and applies
// the same status updates pushBatchToMiva now applies automatically going
// forward, so Run History reflects reality for batches pushed before today.
import { initRepository, getRepository } from "../db";
import type { AuditLogRecord } from "../db/types";

const PUSH_ACTIONS = new Set(["API_PUSH_SUCCEEDED", "API_PUSH_FAILED", "API_PUSH_PARTIAL_FAILURE"]);

async function main() {
  await initRepository();
  const repo = getRepository();

  // listAuditLog's default limit (200) is far smaller than this account's
  // full history (see the Activity Log screenshot: "159 events" and
  // growing) -- ask for everything so no older push is missed.
  const entries = await repo.listAuditLog(1_000_000);

  const pushEntries = entries.filter(
    (e): e is AuditLogRecord & { entityId: string } =>
      e.entityType === "batch" && e.entityId !== null && PUSH_ACTIONS.has(e.action),
  );

  const latestUpdateByBatch = new Map<string, AuditLogRecord & { entityId: string }>();
  const latestRollbackByBatch = new Map<string, AuditLogRecord & { entityId: string }>();

  for (const entry of pushEntries) {
    const target = (entry.details as { target?: string }).target;
    const bucket = target === "rollback" ? latestRollbackByBatch : latestUpdateByBatch;
    const existing = bucket.get(entry.entityId);
    if (!existing || new Date(entry.createdAt) > new Date(existing.createdAt)) {
      bucket.set(entry.entityId, entry);
    }
  }

  let statusUpdates = 0;
  for (const [batchId, entry] of latestUpdateByBatch) {
    await repo.updateBatchImportStatus(batchId, entry.action);
    statusUpdates++;
  }

  let rollbackUpdates = 0;
  for (const batchId of latestRollbackByBatch.keys()) {
    await repo.markBatchRolledBack(batchId);
    rollbackUpdates++;
  }

  console.log(`Backfilled import_status for ${statusUpdates} batch(es) from their latest update push.`);
  console.log(`Backfilled rolled_back_at for ${rollbackUpdates} batch(es) from their latest rollback push.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
