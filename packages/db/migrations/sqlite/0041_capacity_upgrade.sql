-- Capture whether setup was already completed before a worker from this release starts.
INSERT INTO `settings` (`key`, `value`, `encrypted`, `updated_at`)
SELECT 'worker.capacityUpgrade.v090', 'pending', 0, CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE EXISTS (SELECT 1 FROM `user`)
ON CONFLICT (`key`) DO NOTHING;
