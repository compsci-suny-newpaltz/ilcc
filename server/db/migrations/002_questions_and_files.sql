-- 002 — real Brightspace exports: one assignment has several graded programs
-- (Q5, Q12, Q17…) and each student uploads many files of mixed types.
--
--   assignments ─┬─ questions ─── test_cases        (test cases now belong to a question)
--                └─ submissions ─┬─ submission_files (every uploaded file, any type)
--                                └─ results (per test case, unchanged) + grades
--
-- A submission_file with question_id set is the program graded for that
-- question. Non-.a files (written answers, LST dumps, PDFs) are kept for
-- the TA to view.

CREATE TABLE questions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id   INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  number          INTEGER,                 -- e.g. 5 for "Q5" — what filename heuristics match against
  title           TEXT NOT NULL,           -- "Q5: push/pop subroutine"
  description     TEXT NOT NULL DEFAULT '',
  ordinal         INTEGER NOT NULL DEFAULT 0,
  UNIQUE (assignment_id, number)
);
CREATE INDEX idx_questions_assignment ON questions(assignment_id, ordinal);

-- Every existing assignment gets one implicit question so old test cases keep working.
INSERT INTO questions (assignment_id, number, title, ordinal)
  SELECT id, 1, 'Q1', 0 FROM assignments;

ALTER TABLE test_cases ADD COLUMN question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE;
UPDATE test_cases SET question_id = (SELECT q.id FROM questions q WHERE q.assignment_id = test_cases.assignment_id AND q.number = 1);
CREATE INDEX idx_test_cases_question ON test_cases(question_id, ordinal);

CREATE TABLE submission_files (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id   INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_id     INTEGER REFERENCES questions(id) ON DELETE SET NULL,   -- NULL = attachment / unmapped
  name            TEXT NOT NULL,           -- original filename
  ext             TEXT NOT NULL,           -- 'a' 'txt' 'pdf' 'docx' 'c' 'lst' 'e' …
  mime            TEXT NOT NULL DEFAULT 'application/octet-stream',
  size            INTEGER NOT NULL DEFAULT 0,
  is_text         INTEGER NOT NULL DEFAULT 0,
  content_text    TEXT,                    -- for text-like files
  content_blob    BLOB,                    -- for pdf/docx/binary
  submitted_at    TEXT,                    -- from Brightspace index.html when available
  mapped_by       TEXT NOT NULL DEFAULT 'auto' CHECK (mapped_by IN ('auto','ta','student'))
);
CREATE INDEX idx_subfiles_submission ON submission_files(submission_id);
CREATE INDEX idx_subfiles_question ON submission_files(question_id);

-- Existing single-source submissions become one .a file mapped to Q1.
INSERT INTO submission_files (submission_id, question_id, name, ext, mime, size, is_text, content_text, mapped_by)
  SELECT s.id,
         (SELECT q.id FROM questions q WHERE q.assignment_id = s.assignment_id AND q.number = 1),
         'submission.a', 'a', 'text/plain', length(s.source), 1, s.source, 'student'
  FROM submissions s;

-- results now key on the file that was graded (a submission can have many programs).
ALTER TABLE results ADD COLUMN file_id INTEGER REFERENCES submission_files(id) ON DELETE CASCADE;
UPDATE results SET file_id = (SELECT f.id FROM submission_files f WHERE f.submission_id = results.submission_id LIMIT 1);

-- Keep submissions.source for backward compat (student self-submit still uses it),
-- but it is no longer the only program. The SQLite ALTER limitations mean we
-- leave the column and just stop requiring it: allow ''.
