/*
 * grader.js — TA/admin autograder API. Mounted at /api/grader behind requireRole('ta').
 *
 * Model (see db/migrations/002): assignment → questions → test_cases;
 * submission → submission_files (one per question + attachments) → results.
 */
const express = require('express');
const multer  = require('multer');
const db      = require('../db');
const config  = require('../config');
const logger  = require('../logger');
const { parseSubmissionsZip } = require('../services/submissions-zip');
const { gradeSubmission, gradeAssignment } = require('../services/grader');
const { storeSubmission, questionIdFor, questionsFor, filesFor } = require('../services/submissions');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxZipMb * 1024 * 1024, files: 1 } });

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const toBool = (v) => (v === true || v === 1 || v === '1' || v === 'true') ? 1 : 0;

/* ---------- prepared statements ---------- */

const q = {
  listAssignments: db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM questions qq WHERE qq.assignment_id = a.id)  AS question_count,
      (SELECT COUNT(*) FROM test_cases t WHERE t.assignment_id = a.id)  AS test_case_count,
      (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submission_count
    FROM assignments a ORDER BY a.created_at DESC`),
  getAssignment: db.prepare('SELECT * FROM assignments WHERE id = ?'),
  insertAssignment: db.prepare(`INSERT INTO assignments (title, chapter, description, due_at, is_open, created_by_email)
    VALUES (@title, @chapter, @description, @due_at, @is_open, @created_by_email)`),
  updateAssignment: db.prepare(`UPDATE assignments SET title=@title, chapter=@chapter, description=@description,
    due_at=@due_at, is_open=@is_open, updated_at=datetime('now') WHERE id=@id`),
  deleteAssignment: db.prepare('DELETE FROM assignments WHERE id = ?'),

  questions: db.prepare('SELECT * FROM questions WHERE assignment_id = ? ORDER BY ordinal, number, id'),
  getQuestion: db.prepare('SELECT * FROM questions WHERE id = ?'),
  insertQuestion: db.prepare(`INSERT INTO questions (assignment_id, number, title, description, ordinal)
    VALUES (@assignment_id, @number, @title, @description, @ordinal)`),
  updateQuestion: db.prepare('UPDATE questions SET number=@number, title=@title, description=@description, ordinal=@ordinal WHERE id=@id'),
  deleteQuestion: db.prepare('DELETE FROM questions WHERE id = ?'),

  testCases: db.prepare('SELECT * FROM test_cases WHERE assignment_id = ? ORDER BY ordinal, id'),
  questionCases: db.prepare('SELECT * FROM test_cases WHERE question_id = ? ORDER BY ordinal, id'),
  deleteQuestionCases: db.prepare('DELETE FROM test_cases WHERE question_id = ?'),
  insertTestCase: db.prepare(`INSERT INTO test_cases (assignment_id, question_id, name, stdin, expected_stdout, weight, ordinal)
    VALUES (@assignment_id, @question_id, @name, @stdin, @expected_stdout, @weight, @ordinal)`),
  updateTestCase: db.prepare(`UPDATE test_cases SET name=@name, stdin=@stdin, expected_stdout=@expected_stdout,
    weight=@weight, ordinal=@ordinal WHERE id=@id`),
  deleteTestCase: db.prepare('DELETE FROM test_cases WHERE id = ?'),
  getTestCase: db.prepare('SELECT * FROM test_cases WHERE id = ?'),

  results: db.prepare(`
    SELECT s.id AS submission_id, s.assignment_id, s.student_email, s.student_name, s.org_defined_id, s.submitted_at, s.status,
           g.score, g.max_score, g.feedback, g.graded_by_email, g.graded_at
    FROM submissions s LEFT JOIN grades g ON g.submission_id = s.id
    WHERE s.assignment_id = ? ORDER BY s.student_name, s.student_email`),
  resultRow: db.prepare(`
    SELECT s.id AS submission_id, s.assignment_id, s.student_email, s.student_name, s.org_defined_id, s.submitted_at, s.status,
           g.score, g.max_score, g.feedback, g.graded_by_email, g.graded_at
    FROM submissions s LEFT JOIN grades g ON g.submission_id = s.id WHERE s.id = ?`),
  resultRows: db.prepare(`SELECT r.*, t.name AS test_name, t.weight, t.question_id FROM results r JOIN test_cases t ON t.id = r.test_case_id
    WHERE r.submission_id = ? ORDER BY t.ordinal, t.id`),
  submissionSource: db.prepare('SELECT source FROM submissions WHERE id = ?'),
  getSubmission: db.prepare('SELECT id, assignment_id FROM submissions WHERE id = ?'),
  getFile: db.prepare('SELECT * FROM submission_files WHERE id = ? AND submission_id = ?'),
  unmapQuestion: db.prepare('UPDATE submission_files SET question_id = NULL, mapped_by = ? WHERE submission_id = ? AND question_id = ? AND id != ?'),
  mapFile: db.prepare('UPDATE submission_files SET question_id = ?, mapped_by = ? WHERE id = ?'),
  firstMappedA: db.prepare(`SELECT f.content_text FROM submission_files f JOIN questions qq ON qq.id = f.question_id
    WHERE f.submission_id = ? AND f.ext = 'a' ORDER BY qq.ordinal, qq.number, f.id LIMIT 1`),
  setSource: db.prepare('UPDATE submissions SET source = ? WHERE id = ?'),
  manualGrade: db.prepare(`INSERT INTO grades (submission_id, score, max_score, feedback, graded_by_email)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(submission_id) DO UPDATE SET score=excluded.score, max_score=excluded.max_score,
      feedback=excluded.feedback, graded_by_email=excluded.graded_by_email, graded_at=datetime('now')`),
  currentMax: db.prepare('SELECT COALESCE(SUM(weight),0) AS m FROM test_cases WHERE assignment_id = (SELECT assignment_id FROM submissions WHERE id = ?)'),
};

/* ---------- validation ---------- */

function validateAssignment(b) {
  const title = String(b.title || '').trim();
  if (!title) throw bad('title required');
  return {
    title,
    chapter: b.chapter == null || b.chapter === '' ? null : Number(b.chapter),
    description: String(b.description || ''),
    due_at: b.due_at ? new Date(b.due_at).toISOString() : null,
    is_open: b.is_open == null ? 1 : toBool(b.is_open),
  };
}
function validateTestCase(b, i = 0) {
  const name = String(b.name || `case ${i + 1}`).trim();
  if (b.expected_stdout == null) throw bad(`test case "${name}": expected_stdout required`);
  const weight = b.weight == null ? 1 : Number(b.weight);
  if (!(weight >= 0)) throw bad(`test case "${name}": weight must be >= 0`);
  return { name, stdin: String(b.stdin || ''), expected_stdout: String(b.expected_stdout), weight, ordinal: Number(b.ordinal ?? i) };
}
function validateQuestion(b, i = 0) {
  const number = b.number == null || b.number === '' ? i + 1 : Number(b.number);
  if (!Number.isInteger(number) || number < 0) throw bad(`question ${i + 1}: number must be a non-negative integer`);
  return {
    id: b.id == null ? null : Number(b.id),
    number, title: String(b.title || `Q${number}`).trim() || `Q${number}`,
    description: String(b.description || ''), ordinal: Number(b.ordinal ?? i),
    testCases: (Array.isArray(b.testCases) ? b.testCases : []).map(validateTestCase),
  };
}
/* Body may carry questions[] (v2) or a flat testCases[] (legacy → question 1). Null = leave untouched. */
function questionsFromBody(b) {
  if (Array.isArray(b.questions)) {
    const qs = b.questions.map(validateQuestion);
    const nums = qs.map(x => x.number);
    if (new Set(nums).size !== nums.length) throw bad('question numbers must be unique');
    return qs;
  }
  if (Array.isArray(b.testCases)) return [validateQuestion({ number: 1, title: 'Q1', testCases: b.testCases }, 0)];
  return null;
}

/*
 * Replace an assignment's questions with `qs`. A question whose `id` (or
 * number) matches an existing one is updated in place so submission_files
 * mappings survive edits; the rest are inserted; leftovers are deleted.
 */
const replaceQuestions = db.transaction((assignmentId, qs) => {
  const existing = q.questions.all(assignmentId);
  const keep = new Set();
  qs.forEach((x, i) => {
    const match = existing.find(e => (x.id != null && e.id === x.id && !keep.has(e.id)))
      ?? existing.find(e => e.number === x.number && !keep.has(e.id));
    let id;
    if (match) {
      /* Deleting a clashing number first avoids UNIQUE(assignment_id, number) on swaps. */
      id = match.id;
      q.updateQuestion.run({ id, number: null, title: x.title, description: x.description, ordinal: x.ordinal ?? i });
    } else {
      id = q.insertQuestion.run({ assignment_id: assignmentId, number: null, title: x.title, description: x.description, ordinal: x.ordinal ?? i }).lastInsertRowid;
    }
    keep.add(id);
    x._id = id;
  });
  for (const e of existing) if (!keep.has(e.id)) q.deleteQuestion.run(e.id);
  for (const x of qs) {
    q.updateQuestion.run({ id: x._id, number: x.number, title: x.title, description: x.description, ordinal: x.ordinal });
    q.deleteQuestionCases.run(x._id);
    x.testCases.forEach(tc => q.insertTestCase.run({ ...tc, assignment_id: assignmentId, question_id: x._id }));
  }
});

function assignmentView(id) {
  const a = q.getAssignment.get(id);
  if (!a) return null;
  const questions = q.questions.all(id).map(x => ({ ...x, testCases: q.questionCases.all(x.id) }));
  /* Flat testCases kept for older clients. */
  return { ...a, questions, testCases: q.testCases.all(id) };
}

/* ---------- assignments ---------- */

router.get('/assignments', (req, res) => res.json(q.listAssignments.all()));

router.post('/assignments', (req, res, next) => {
  try {
    const a = validateAssignment(req.body || {});
    const qs = questionsFromBody(req.body || {}) || [];
    const id = db.transaction(() => {
      const r = q.insertAssignment.run({ ...a, created_by_email: req.user.email });
      replaceQuestions(r.lastInsertRowid, qs);
      return r.lastInsertRowid;
    })();
    res.status(201).json(assignmentView(id));
  } catch (e) { next(e); }
});

router.get('/assignments/:id', (req, res, next) => {
  const v = assignmentView(req.params.id);
  if (!v) return next(bad('not found', 404));
  res.json(v);
});

router.put('/assignments/:id', (req, res, next) => {
  try {
    const cur = q.getAssignment.get(req.params.id);
    if (!cur) throw bad('not found', 404);
    const a = validateAssignment(req.body || {});
    const qs = questionsFromBody(req.body || {});
    db.transaction(() => {
      q.updateAssignment.run({ ...a, id: cur.id });
      if (qs) replaceQuestions(cur.id, qs);
    })();
    res.json(assignmentView(cur.id));
  } catch (e) { next(e); }
});

router.delete('/assignments/:id', (req, res) => {
  q.deleteAssignment.run(req.params.id);
  res.status(204).end();
});

/* ---------- test cases (single-case edits; questionId optional → lowest question) ---------- */

router.post('/assignments/:id/test-cases', (req, res, next) => {
  try {
    const a = q.getAssignment.get(req.params.id);
    if (!a) throw bad('not found', 404);
    const body = req.body || {};
    let question = body.questionId != null ? q.getQuestion.get(body.questionId) : q.questions.all(a.id)[0];
    if (body.questionId != null && (!question || question.assignment_id !== a.id)) throw bad('question not found', 404);
    if (!question) {
      const r = q.insertQuestion.run({ assignment_id: a.id, number: 1, title: 'Q1', description: '', ordinal: 0 });
      question = q.getQuestion.get(r.lastInsertRowid);
    }
    const tc = validateTestCase(body, q.questionCases.all(question.id).length);
    const r = q.insertTestCase.run({ ...tc, assignment_id: a.id, question_id: question.id });
    res.status(201).json(q.getTestCase.get(r.lastInsertRowid));
  } catch (e) { next(e); }
});
router.put('/test-cases/:id', (req, res, next) => {
  try {
    const cur = q.getTestCase.get(req.params.id);
    if (!cur) throw bad('not found', 404);
    const tc = validateTestCase({ ...cur, ...req.body }, cur.ordinal);
    q.updateTestCase.run({ ...tc, id: cur.id });
    res.json(q.getTestCase.get(cur.id));
  } catch (e) { next(e); }
});
router.delete('/test-cases/:id', (req, res) => { q.deleteTestCase.run(req.params.id); res.status(204).end(); });

/* ---------- zip parse / import ---------- */

/* Strip contents: the client keeps the File and re-sends it on import. */
const publicFile = ({ content: _c, blob: _b, ...f }) => f;

router.post('/parse-submissions', upload.single('zip'), (req, res, next) => {
  try {
    if (!req.file) throw bad('zip file required (field "zip")');
    const parsed = parseSubmissionsZip(req.file.buffer);
    const out = { students: parsed.students.map(s => ({ ...s, files: s.files.map(publicFile) })), index: parsed.index };
    if (req.query.assignmentId) {
      if (!q.getAssignment.get(req.query.assignmentId)) throw bad('assignment not found', 404);
      out.questions = questionsFor(req.query.assignmentId);
    }
    logger.info({ by: req.user.email, students: out.students.length }, 'parsed submissions zip');
    res.json(out);
  } catch (e) { next(e); }
});

/*
 * Import the zip for real. `mapping` overrides the parser's questionNumber
 * per student+file ({ orgId: { fileName: number|null } }); anything that
 * doesn't resolve to a question of this assignment becomes an attachment.
 */
router.post('/submissions/import', upload.single('zip'), (req, res, next) => {
  try {
    if (!req.file) throw bad('zip file required (field "zip")');
    const assignmentId = Number(req.body?.assignmentId);
    if (!q.getAssignment.get(assignmentId)) throw bad('assignment not found', 404);
    let mapping = {};
    if (req.body?.mapping) {
      try { mapping = JSON.parse(req.body.mapping); } catch { throw bad('mapping must be JSON'); }
      if (!mapping || typeof mapping !== 'object') throw bad('mapping must be an object');
    }
    const questions = questionsFor(assignmentId);
    const { students } = parseSubmissionsZip(req.file.buffer);
    const unmapped = [];
    const ids = db.transaction(() => students.map(s => {
      const key = s.orgDefinedId || s.displayName;
      const override = mapping[key] || {};
      const files = s.files.map(f => {
        const number = Object.prototype.hasOwnProperty.call(override, f.name) ? override[f.name] : f.questionNumber;
        const questionId = questionIdFor(questions, number);
        if (questionId == null && f.ext === 'a' && !Object.prototype.hasOwnProperty.call(override, f.name)) {   // a TA's explicit 'attachment' isn't a problem
          if (number != null) unmapped.push({ student: key, file: f.name, reason: `looks like question ${number}, but this assignment has no question ${number}` });
          else if (f.ext === 'a') unmapped.push({ student: key, file: f.name, reason: 'no question number in the filename' });
        }
        return { name: f.name, ext: f.ext, mime: f.mime, size: f.size, isText: f.isText, content: f.content, blob: f.blob,
          submittedAt: f.submittedAt, questionId, mappedBy: Object.prototype.hasOwnProperty.call(override, f.name) ? 'ta' : 'auto' };
      });
      const email = s.orgDefinedId ? `${s.orgDefinedId}@import` : `${s.displayName.replace(/\W+/g, '.').toLowerCase()}@import`;
      return storeSubmission({ assignmentId, email, name: s.displayName, orgDefinedId: s.orgDefinedId }, files).id;
    }))();
    logger.info({ by: req.user.email, assignmentId, count: ids.length, unmapped: unmapped.length }, 'imported submissions');
    res.status(201).json({ count: ids.length, ids, unmapped });
  } catch (e) { next(e); }
});

/* Legacy JSON bulk upsert: one source string per student → "submission.a" on the lowest question. */
router.post('/submissions/bulk', (req, res, next) => {
  try {
    const { assignmentId, students } = req.body || {};
    if (!q.getAssignment.get(assignmentId)) throw bad('assignment not found', 404);
    if (!Array.isArray(students) || !students.length) throw bad('students[] required');
    const lowest = questionsFor(assignmentId)[0]?.id ?? null;
    const ids = db.transaction(() => students.map(s => {
      const email = String(s.email || (s.orgDefinedId ? `${s.orgDefinedId}@import` : '')).toLowerCase();
      if (!email) throw bad('each student needs email or orgDefinedId');
      if (typeof s.source !== 'string') throw bad(`${email}: source required`);
      return storeSubmission(
        { assignmentId, email, name: String(s.name || s.displayName || ''), orgDefinedId: s.orgDefinedId || null },
        [{ name: 'submission.a', content: s.source, questionId: lowest, mappedBy: 'ta' }],
      ).id;
    }))();
    res.status(201).json({ ids, count: ids.length });
  } catch (e) { next(e); }
});

/* ---------- grading ---------- */

router.post('/submissions/:id/grade', async (req, res, next) => {
  try { res.json(await gradeSubmission(Number(req.params.id))); } catch (e) { next(e); }
});

router.post('/assignments/:id/grade-all', async (req, res, next) => {
  try {
    if (!q.getAssignment.get(req.params.id)) throw bad('not found', 404);
    res.json(await gradeAssignment(Number(req.params.id)));
  } catch (e) { next(e); }
});

/* One results row: files[] + questions[] (per-question file + cases) + flat results[] for older clients. */
function resultView(r, questions) {
  const files = filesFor(r.submission_id);
  const rows = q.resultRows.all(r.submission_id).map(x => ({ ...x, diff: x.diff_json ? JSON.parse(x.diff_json) : [], diff_json: undefined }));
  const qs = questions.map(qq => {
    const cases = q.questionCases.all(qq.id);
    const results = cases.map(tc => {
      const x = rows.find(y => y.test_case_id === tc.id);
      return { test_case_id: tc.id, name: tc.name, weight: tc.weight, passed: x ? !!x.passed : null,
        runtime_ms: x?.runtime_ms ?? null, error: x?.error ?? null, diff: x?.diff ?? [] };
    });
    return {
      question_id: qq.id, number: qq.number, title: qq.title,
      file_id: files.find(f => f.question_id === qq.id)?.id ?? null,
      score: results.reduce((n, x) => n + (x.passed ? x.weight : 0), 0),
      max: cases.reduce((n, tc) => n + tc.weight, 0),
      results,
    };
  });
  return { ...r, files, questions: qs, results: rows };
}

router.get('/assignments/:id/results', (req, res, next) => {
  if (!q.getAssignment.get(req.params.id)) return next(bad('not found', 404));
  const questions = q.questions.all(req.params.id);
  res.json(q.results.all(req.params.id).map(r => resultView(r, questions)));
});

router.get('/submissions/:id', (req, res, next) => {
  const r = q.resultRow.get(req.params.id);
  if (!r) return next(bad('not found', 404));
  res.json(resultView(r, q.questions.all(r.assignment_id)));
});

router.get('/submissions/:id/source', (req, res, next) => {
  const row = q.submissionSource.get(req.params.id);
  if (!row) return next(bad('not found', 404));
  res.type('text/plain').send(row.source);
});

/* ---------- files ---------- */

router.get('/submissions/:id/files/:fileId', (req, res, next) => {
  const f = q.getFile.get(req.params.fileId, req.params.id);
  if (!f) return next(bad('not found', 404));
  const safe = f.name.replace(/[^\w.-]+/g, '_');
  if (f.is_text) {
    res.setHeader('Content-Disposition', `inline; filename="${safe}"`);
    return res.type('text/plain').send(f.content_text ?? '');
  }
  const inline = f.mime === 'application/pdf';
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${safe}"`);
  res.send(f.content_blob ?? Buffer.alloc(0));
});

/* Remap a file to a question (or null = attachment). One file per question: the previous holder is unmapped. */
router.put('/submissions/:id/files/:fileId', (req, res, next) => {
  try {
    const sub = q.getSubmission.get(req.params.id);
    const f = sub && q.getFile.get(req.params.fileId, sub.id);
    if (!f) throw bad('not found', 404);
    const { questionId = null } = req.body || {};
    if (questionId != null) {
      const qq = q.getQuestion.get(questionId);
      if (!qq || qq.assignment_id !== sub.assignment_id) throw bad('question not found', 404);
    }
    db.transaction(() => {
      if (questionId != null) q.unmapQuestion.run('ta', sub.id, questionId, f.id);
      q.mapFile.run(questionId, 'ta', f.id);
      q.setSource.run(q.firstMappedA.get(sub.id)?.content_text ?? '', sub.id);
    })();
    res.json(filesFor(sub.id));
  } catch (e) { next(e); }
});

/* ---------- manual grade + export ---------- */

router.put('/submissions/:id/grade', (req, res, next) => {
  try {
    const { score, feedback = '' } = req.body || {};
    if (!(Number(score) >= 0)) throw bad('score must be >= 0');
    const max = q.currentMax.get(req.params.id)?.m ?? 0;
    q.manualGrade.run(req.params.id, Number(score), max, String(feedback), req.user.email);
    res.json({ submissionId: Number(req.params.id), score: Number(score), maxScore: max, feedback, gradedBy: req.user.email });
  } catch (e) { next(e); }
});

/* Brightspace grade import format. */
router.get('/assignments/:id/export.csv', (req, res, next) => {
  const a = q.getAssignment.get(req.params.id);
  if (!a) return next(bad('not found', 404));
  const rows = q.results.all(a.id);
  const col = `${a.title} Points Grade`;
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['OrgDefinedId', col, 'End-of-Line Indicator'].map(esc).join(',')];
  for (const r of rows) {
    const id = r.org_defined_id || r.student_email.split('@')[0];
    lines.push([esc(id), esc(r.score ?? ''), esc('#')].join(','));
  }
  res.setHeader('Content-Disposition', `attachment; filename="${a.title.replace(/[^\w.-]+/g, '_')}-grades.csv"`);
  res.type('text/csv').send(lines.join('\r\n') + '\r\n');
});

module.exports = router;
