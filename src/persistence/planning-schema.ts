export const planningSchema = `
ALTER TABLE tasks ADD COLUMN review_profile TEXT NOT NULL DEFAULT 'scoped' CHECK(review_profile IN ('scoped','full-review'));
ALTER TABLE tasks ADD COLUMN model_phase TEXT NOT NULL DEFAULT 'PLANNING' CHECK(model_phase IN ('PLANNING','PROVIDER','SYNTHESIS'));
ALTER TABLE model_calls ADD COLUMN purpose TEXT NOT NULL DEFAULT 'LEGACY' CHECK(purpose IN ('LEGACY','PLANNING','PROVIDER','SYNTHESIS'));
CREATE TABLE procurement_plans (
 task_id TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id), payload_json TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE TRIGGER plan_no_update BEFORE UPDATE ON procurement_plans BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER plan_no_delete BEFORE DELETE ON procurement_plans BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER review_profile_frozen BEFORE UPDATE OF review_profile ON tasks WHEN NEW.review_profile!=OLD.review_profile BEGIN SELECT RAISE(ABORT,'IMMUTABLE_REVIEW_PROFILE'); END;
`;
