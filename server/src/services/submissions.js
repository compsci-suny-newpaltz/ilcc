/*
 * submissions.js — store a submission and its files (shared by the TA import
 * routes and the student self-submit route).
 *
 * Invariants kept here so every writer agrees:
 *   • at most ONE file per (submission, question) — extras become attachments
 *   • submissions.source mirrors the first mapped .a (legacy readers + /source)
 *   • replacing files drops stale results; the row goes back to 'pending'
 */
const db = require('../db');

const q = {
  questions: db.prepare('SELECT id, number, title FROM questions WHERE assignment_id = ? ORDER BY ordinal, number, id'),
  upsert: db.prepare(`INSERT INTO submissions (assignment_id, student_email, student_name, org_defined_id, source)
    VALUES (@assignment_id, @student_email, @student_name, @org_defined_id, @source)
    ON CONFLICT(assignment_id, student_email) DO UPDATE SET
      student_name = CASE WHEN excluded.student_name = '' THEN submissions.student_name ELSE excluded.student_name END,
      org_defined_id = COALESCE(excluded.org_defined_id, submissions.org_defined_id),
      source = excluded.source, submitted_at = datetime('now'), status = 'pending'`),
  byKey: db.prepare('SELECT id FROM submissions WHERE assignment_id = ? AND student_email = ?'),
  deleteFiles: db.prepare('DELETE FROM submission_files WHERE submission_id = ?'),
  deleteResults: db.prepare('DELETE FROM results WHERE submission_id = ?'),
  insertFile: db.prepare(`INSERT INTO submission_files
    (submission_id, question_id, name, ext, mime, size, is_text, content_text, content_blob, submitted_at, mapped_by)
    VALUES (@submission_id, @question_id, @name, @ext, @mime, @size, @is_text, @content_text, @content_blob, @submitted_at, @mapped_by)`),
  files: db.prepare(`SELECT f.id, f.name, f.ext, f.mime, f.size, f.is_text, f.question_id, qq.number AS question_number, f.submitted_at, f.mapped_by
    FROM submission_files f LEFT JOIN questions qq ON qq.id = f.question_id
    WHERE f.submission_id = ? ORDER BY f.question_id IS NULL, qq.number, f.name`),
};

const extOf = (name) => (String(name).match(/\.([A-Za-z0-9]+)$/)?.[1] || '').toLowerCase();

/* questionId for a number, or null when the assignment has no such question. */
function questionIdFor(questions, number) {
  if (number == null) return null;
  return questions.find(x => x.number === Number(number))?.id ?? null;
}

/*
 * Normalise a caller-supplied file into a submission_files row (minus submission_id).
 * Accepts { name, questionId?, content? (string) | blob? (Buffer), ext?, mime?, isText?, submittedAt?, mappedBy? }.
 */
function toFileRow(f) {
  const ext = f.ext ?? extOf(f.name);
  const isText = f.isText ?? (typeof f.content === 'string');
  const content = isText ? String(f.content ?? '') : null;
  const blob = isText ? null : (Buffer.isBuffer(f.blob) ? f.blob : Buffer.alloc(0));
  return {
    question_id: f.questionId ?? null,
    name: String(f.name || 'file'), ext,
    mime: f.mime || (isText ? 'text/plain' : 'application/octet-stream'),
    size: f.size ?? (isText ? Buffer.byteLength(content) : blob.length),
    is_text: isText ? 1 : 0, content_text: content, content_blob: blob,
    submitted_at: f.submittedAt ?? null,
    mapped_by: f.mappedBy || 'auto',
  };
}

/*
 * storeSubmission({ assignmentId, email, name, orgDefinedId }, files) → { id, files }
 * files: see toFileRow. Replaces any previous files for that student+assignment.
 */
const storeSubmission = db.transaction(({ assignmentId, email, name = '', orgDefinedId = null }, files) => {
  const seen = new Set();
  const rows = files.map(toFileRow).map(r => {
    /* Second file claiming the same question → attachment, so the rule holds. */
    if (r.question_id != null && seen.has(r.question_id)) return { ...r, question_id: null };
    if (r.question_id != null) seen.add(r.question_id);
    return r;
  });
  const first = rows.find(r => r.question_id != null && r.ext === 'a') || rows.find(r => r.question_id != null && r.is_text);
  q.upsert.run({ assignment_id: assignmentId, student_email: email, student_name: name, org_defined_id: orgDefinedId, source: first?.content_text ?? '' });
  const { id } = q.byKey.get(assignmentId, email);
  q.deleteResults.run(id);
  q.deleteFiles.run(id);
  for (const r of rows) q.insertFile.run({ ...r, submission_id: id });
  return { id, files: q.files.all(id) };
});

module.exports = { storeSubmission, questionIdFor, questionsFor: (assignmentId) => q.questions.all(assignmentId), filesFor: (id) => q.files.all(id), extOf };
