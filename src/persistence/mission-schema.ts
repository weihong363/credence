export const missionSchema=`
CREATE TABLE mission_requests(owner_id TEXT NOT NULL REFERENCES owners(id),key TEXT NOT NULL,request_hash TEXT NOT NULL,
 task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),PRIMARY KEY(owner_id,key)) STRICT;
CREATE TRIGGER mission_request_no_update BEFORE UPDATE ON mission_requests BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER mission_request_no_delete BEFORE DELETE ON mission_requests BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TABLE mission_resume_commands(owner_id TEXT NOT NULL REFERENCES owners(id),key TEXT NOT NULL,task_id TEXT NOT NULL REFERENCES tasks(id),PRIMARY KEY(owner_id,key)) STRICT;
CREATE TRIGGER mission_resume_no_update BEFORE UPDATE ON mission_resume_commands BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TRIGGER mission_resume_no_delete BEFORE DELETE ON mission_resume_commands BEGIN SELECT RAISE(ABORT,'APPEND_ONLY'); END;
CREATE TABLE mission_leases(task_id TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id),token TEXT NOT NULL,lease_until INTEGER NOT NULL) STRICT;
`;
