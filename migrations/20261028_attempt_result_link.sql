-- Add a nullable, unique relationship for results created by attempt finalization.
-- Existing historical result rows remain unlinked and are not backfilled.
BEGIN;

ALTER TABLE results
  ADD COLUMN attempt_id integer;

ALTER TABLE results
  ADD CONSTRAINT results_attempt_id_fkey
  FOREIGN KEY (attempt_id) REFERENCES test_attempts(id) ON DELETE SET NULL;

ALTER TABLE results
  ADD CONSTRAINT results_attempt_id_unique UNIQUE (attempt_id);

COMMIT;
