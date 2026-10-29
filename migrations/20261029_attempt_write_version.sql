-- Reject delayed attempt writes when a newer snapshot has already been stored.
BEGIN;

ALTER TABLE test_attempts
  ADD COLUMN write_version integer NOT NULL DEFAULT 0;

COMMIT;
