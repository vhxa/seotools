-- Capture whether setup was already completed before a worker from this release starts.
INSERT INTO "settings" ("key", "value", "encrypted", "updated_at")
SELECT 'worker.capacityUpgrade.v090', 'pending', false, CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "user")
ON CONFLICT ("key") DO NOTHING;
