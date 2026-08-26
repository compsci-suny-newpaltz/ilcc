/* Autograder v2: questions per assignment + multi-file submissions, driven by a real Brightspace export. */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import request from 'supertest';
import { get, post, put, ADMIN, STUDENT, app } from './helpers.js';

const ZIP = path.join(__dirname, 'fixtures', 'brightspace-lab4.zip');
const ADLER = '460366';   // Bethany Adler: ch3p5.a prints 3

describe('assignments with questions', () => {
  let aid;
  it('POST creates nested questions → testCases; legacy testCases become Q1', async () => {
    const r = await post('/api/grader/assignments', {
      title: 'Lab 4', chapter: 3,
      questions: [
        { number: 5,  title: 'Q5',  testCases: [{ name: 'prints 3', stdin: '', expected_stdout: '3\n' }] },
        { number: 12, title: 'Q12', testCases: [{ name: 'x', stdin: '', expected_stdout: 'nope' }] },
        { number: 17, title: 'Q17', testCases: [{ name: 'y', stdin: '', expected_stdout: 'nope', weight: 2 }] },
      ],
    }, ADMIN);
    expect(r.status).toBe(201);
    aid = r.body.id;
    expect(r.body.questions.map(x => [x.number, x.testCases.length])).toEqual([[5, 1], [12, 1], [17, 1]]);
    expect(r.body.testCases).toHaveLength(3);

    const legacy = await post('/api/grader/assignments', { title: 'Old', testCases: [{ expected_stdout: '1' }] }, ADMIN);
    expect(legacy.body.questions).toMatchObject([{ number: 1, testCases: [{ expected_stdout: '1' }] }]);

    const list = (await get('/api/grader/assignments', ADMIN)).body.find(x => x.id === aid);
    expect(list).toMatchObject({ question_count: 3, test_case_count: 3, submission_count: 0 });
    expect((await post('/api/grader/assignments', { title: 'dup', questions: [{ number: 1 }, { number: 1 }] }, ADMIN)).status).toBe(400);
  });

  it('PUT keeps question ids when provided, drops omitted ones', async () => {
    const before = (await get(`/api/grader/assignments/${aid}`, ADMIN)).body.questions;
    const [q5, q12] = before;
    const r = await put(`/api/grader/assignments/${aid}`, {
      title: 'Lab 4', questions: [
        { id: q5.id, number: 5, title: 'Q5 renamed', testCases: [{ name: 'prints 3', stdin: '', expected_stdout: '3\n' }] },
        { id: q12.id, number: 12, title: 'Q12', testCases: [{ name: 'x', stdin: '', expected_stdout: 'nope' }] },
        { number: 17, title: 'Q17', testCases: [{ name: 'y', stdin: '', expected_stdout: 'nope', weight: 2 }] },
      ],
    }, ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.questions[0]).toMatchObject({ id: q5.id, title: 'Q5 renamed' });
    expect(r.body.questions[1].id).toBe(q12.id);
    /* number-only match (no id) also keeps the row */
    expect(r.body.questions[2].id).toBe(before[2].id);
    /* title-only PUT leaves questions alone */
    await put(`/api/grader/assignments/${aid}`, { title: 'Lab 4' }, ADMIN);
    expect((await get(`/api/grader/assignments/${aid}`, ADMIN)).body.questions).toHaveLength(3);
  });
});

describe('Brightspace zip → import → grade → files', () => {
  let aid, qs, adlerId, adlerFiles;

  it('parse: 26 students, 67 .a all numbered, 3 resubmitters, no contents; questions when ?assignmentId', async () => {
    const a = await post('/api/grader/assignments', {
      title: 'Lab 4 real',
      questions: [5, 12, 17].map(n => ({ number: n, title: `Q${n}`, testCases: [{ name: 'c', stdin: '', expected_stdout: n === 5 ? '3' : 'nope' }] })),
    }, ADMIN);
    aid = a.body.id; qs = a.body.questions;

    const r = await request(app()).post(`/api/grader/parse-submissions?assignmentId=${aid}`).set(ADMIN).attach('zip', ZIP);
    expect(r.status).toBe(200);
    const { students, index, questions } = r.body;
    expect(students).toHaveLength(26);
    expect(index).toEqual({ hasIndex: true, names: 26 });
    expect(questions.map(x => x.number)).toEqual([5, 12, 17]);
    const asm = students.flatMap(s => s.files.filter(f => f.ext === 'a'));
    expect(asm).toHaveLength(67);
    expect(asm.every(f => Number.isInteger(f.questionNumber))).toBe(true);
    expect(students.filter(s => s.folders.length === 2)).toHaveLength(3);
    expect(students.flatMap(s => s.files).some(f => 'content' in f || 'blob' in f)).toBe(false);
    expect(students.find(s => s.orgDefinedId === ADLER).files.map(f => f.name)).toContain('ch3p5.a');
  });

  it('import with a mapping override; results have files[] and questions[] with file_id', async () => {
    /* Override: Adler's ch3p12.a → Q17, ch3p17.a → attachment (null). */
    const mapping = { [ADLER]: { 'ch3p12.a': 17, 'ch3p17.a': null } };
    const r = await request(app()).post('/api/grader/submissions/import').set(ADMIN)
      .field('assignmentId', String(aid)).field('mapping', JSON.stringify(mapping)).attach('zip', ZIP);
    expect(r.status).toBe(201);
    expect(r.body.count).toBe(26);
    expect(r.body.ids).toHaveLength(26);
    /* A TA's explicit 'attachment' choice is not a problem, so it's not reported; files the parser couldn't place are, with a reason. */
    expect(r.body.unmapped).not.toContainEqual(expect.objectContaining({ student: ADLER, file: 'ch3p17.a' }));
    expect(r.body.unmapped.length).toBeGreaterThan(0);
    expect(r.body.unmapped.every(u => typeof u.reason === 'string' && u.file.endsWith('.a'))).toBe(true);

    const g = await post(`/api/grader/assignments/${aid}/grade-all`, {}, ADMIN);
    expect(g.body).toMatchObject({ graded: 26, errors: 0, total: 26 });

    const rows = (await get(`/api/grader/assignments/${aid}/results`, ADMIN)).body;
    expect(rows).toHaveLength(26);
    expect(rows.flatMap(x => x.files).filter(f => f.ext === 'pdf').length).toBeGreaterThan(0);
    expect(rows.flatMap(x => x.files).filter(f => f.ext === 'txt').length).toBeGreaterThan(0);

    const adler = rows.find(x => x.org_defined_id === ADLER);
    adlerId = adler.submission_id; adlerFiles = adler.files;
    expect(adler.student_email).toBe(`${ADLER}@import`);
    expect(adler.student_name).toBe('Bethany Adler');
    expect(adler.files.map(f => f.name).sort()).toEqual(['ch3p12.a', 'ch3p17.a', 'ch3p5.a', 'ch3q24-25.txt', 'lab4_lst.txt']);
    expect(adler.files.find(f => f.name === 'ch3p5.a')).toMatchObject({ ext: 'a', mime: 'text/plain', is_text: 1, question_number: 5, mapped_by: 'auto' });
    expect(adler.files.find(f => f.name === 'ch3p12.a')).toMatchObject({ question_number: 17, mapped_by: 'ta' });
    expect(adler.files.find(f => f.name === 'ch3p17.a').question_id).toBeNull();
    expect(adler.files.find(f => f.name === 'lab4_lst.txt').question_id).toBeNull();

    const byNum = Object.fromEntries(adler.questions.map(x => [x.number, x]));
    expect(byNum[5]).toMatchObject({ file_id: adler.files.find(f => f.name === 'ch3p5.a').id, score: 1, max: 1 });
    expect(byNum[5].results[0]).toMatchObject({ passed: true, error: null });
    expect(byNum[17].file_id).toBe(adler.files.find(f => f.name === 'ch3p12.a').id);
    expect(byNum[12]).toMatchObject({ file_id: null, score: 0 });
    expect(byNum[12].results[0]).toMatchObject({ passed: false, error: 'no file mapped to this question' });
    expect(adler).toMatchObject({ status: 'graded', score: 1, max_score: 3 });

    /* single-row endpoint has the same shape */
    const one = await get(`/api/grader/submissions/${adlerId}`, ADMIN);
    expect(one.body.questions.map(x => x.number)).toEqual([5, 12, 17]);
    expect(one.body.files).toHaveLength(5);
    expect((await get('/api/grader/submissions/999999', ADMIN)).status).toBe(404);
    /* legacy /source = first mapped .a */
    expect((await get(`/api/grader/submissions/${adlerId}/source`, ADMIN)).text).toBe(one.body.files && (await get(`/api/grader/submissions/${adlerId}/files/${byNum[5].file_id}`, ADMIN)).text);
  });

  it('GET files/:fileId streams text/plain for .a and inline application/pdf; 404 when not owned', async () => {
    const a = adlerFiles.find(f => f.name === 'ch3p5.a');
    const t = await get(`/api/grader/submissions/${adlerId}/files/${a.id}`, ADMIN);
    expect(t.status).toBe(200);
    expect(t.headers['content-type']).toMatch(/^text\/plain/);
    expect(t.text.length).toBeGreaterThan(0);

    const rows = (await get(`/api/grader/assignments/${aid}/results`, ADMIN)).body;
    const withPdf = rows.find(x => x.files.some(f => f.ext === 'pdf'));
    const pdf = withPdf.files.find(f => f.ext === 'pdf');
    const p = await request(app()).get(`/api/grader/submissions/${withPdf.submission_id}/files/${pdf.id}`).set(ADMIN).buffer(true).parse((res, cb) => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(p.status).toBe(200);
    expect(p.headers['content-type']).toMatch(/^application\/pdf/);
    expect(p.headers['content-disposition']).toMatch(/^inline; filename="/);
    expect(p.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(p.body.length).toBe(pdf.size);

    /* file belongs to a different submission → 404 */
    expect((await get(`/api/grader/submissions/${adlerId}/files/${pdf.id}`, ADMIN)).status).toBe(404);
  });

  it('PUT remap: one file per question, previous holder unmapped; re-grade uses the new file', async () => {
    const q5 = qs.find(x => x.number === 5), q12 = qs.find(x => x.number === 12);
    const p17 = adlerFiles.find(f => f.name === 'ch3p17.a');
    const p5  = adlerFiles.find(f => f.name === 'ch3p5.a');
    /* put ch3p17.a onto Q5 → ch3p5.a is bumped to attachment */
    let r = await put(`/api/grader/submissions/${adlerId}/files/${p17.id}`, { questionId: q5.id }, ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.find(f => f.id === p17.id)).toMatchObject({ question_id: q5.id, mapped_by: 'ta' });
    expect(r.body.find(f => f.id === p5.id).question_id).toBeNull();
    expect(r.body.filter(f => f.question_id === q5.id)).toHaveLength(1);

    const g = await post(`/api/grader/submissions/${adlerId}/grade`, {}, ADMIN);
    const q5r = g.body.results.find(x => x.questionNumber === 5);
    expect(q5r.fileId).toBe(p17.id);
    expect(q5r.passed).toBe(false);          // ch3p17.a does not print 3
    let row = (await get(`/api/grader/submissions/${adlerId}`, ADMIN)).body;
    expect(row.questions.find(x => x.number === 5).file_id).toBe(p17.id);
    expect(row.score).toBe(0);

    /* restore: ch3p5.a → Q5 and fill Q12 → all scored again */
    await put(`/api/grader/submissions/${adlerId}/files/${p5.id}`, { questionId: q5.id }, ADMIN);
    await put(`/api/grader/submissions/${adlerId}/files/${p17.id}`, { questionId: q12.id }, ADMIN);
    await post(`/api/grader/submissions/${adlerId}/grade`, {}, ADMIN);
    row = (await get(`/api/grader/submissions/${adlerId}`, ADMIN)).body;
    expect(row.questions.map(x => x.file_id != null)).toEqual([true, true, true]);
    expect(row.score).toBe(1);
    expect((await get(`/api/grader/submissions/${adlerId}/source`, ADMIN)).text).toBe((await get(`/api/grader/submissions/${adlerId}/files/${p5.id}`, ADMIN)).text);

    /* bad targets */
    expect((await put(`/api/grader/submissions/${adlerId}/files/${p5.id}`, { questionId: 999999 }, ADMIN)).status).toBe(404);
    expect((await put(`/api/grader/submissions/999999/files/${p5.id}`, { questionId: q5.id }, ADMIN)).status).toBe(404);
    /* unmap → attachment */
    r = await put(`/api/grader/submissions/${adlerId}/files/${p17.id}`, { questionId: null }, ADMIN);
    expect(r.body.find(f => f.id === p17.id).question_id).toBeNull();
  });

  it('re-import replaces files and CSV still exports', async () => {
    const r = await request(app()).post('/api/grader/submissions/import').set(ADMIN).field('assignmentId', String(aid)).attach('zip', ZIP);
    expect(r.body.count).toBe(26);
    const row = (await get(`/api/grader/submissions/${adlerId}`, ADMIN)).body;
    expect(row.files).toHaveLength(5);
    expect(row.status).toBe('pending');
    expect(row.files.find(f => f.name === 'ch3p17.a').question_number).toBe(17);
    const csv = await get(`/api/grader/assignments/${aid}/export.csv`, ADMIN);
    expect(csv.text.split('\r\n').filter(Boolean)).toHaveLength(27);
    expect(csv.text).toContain(`"${ADLER}"`);
    expect((await request(app()).post('/api/grader/submissions/import').set(ADMIN).field('assignmentId', '999999').attach('zip', ZIP)).status).toBe(404);
  });

  it('legacy bulk maps submission.a to the lowest question', async () => {
    const r = await post('/api/grader/submissions/bulk', { assignmentId: aid, students: [{ name: 'Legacy Kid', orgDefinedId: '1', source: '    mov r0, 3\n    dout r0\n    halt\n' }] }, ADMIN);
    expect(r.status).toBe(201);
    const g = await post(`/api/grader/submissions/${r.body.ids[0]}/grade`, {}, ADMIN);
    expect(g.body).toMatchObject({ score: 1, maxScore: 3 });
    const row = (await get(`/api/grader/submissions/${r.body.ids[0]}`, ADMIN)).body;
    expect(row.files).toMatchObject([{ name: 'submission.a', question_number: 5 }]);
  });

  it('student POST /submissions with files[] maps by questionNumber; legacy source still works', async () => {
    const files = [
      { questionNumber: 5,  name: 'lab4q5.a',  content: '    mov r0, 3\n    dout r0\n    halt\n' },
      { questionNumber: 12, name: 'lab4q12.a', content: '    mov r0, 4\n    dout r0\n    halt\n' },
    ];
    const r = await post('/api/submissions', { assignmentId: aid, files }, STUDENT);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ score: 1, maxScore: 3 });
    expect(r.body.results.map(x => [x.questionNumber, x.passed, x.error])).toEqual([[5, true, null], [12, false, null], [17, false, 'no file mapped to this question']]);
    const row = (await get(`/api/grader/submissions/${r.body.id}`, ADMIN)).body;
    expect(row.files.map(f => [f.name, f.question_number, f.mapped_by])).toEqual([['lab4q5.a', 5, 'student'], ['lab4q12.a', 12, 'student']]);

    expect((await post('/api/submissions', { assignmentId: aid, files: [{ questionNumber: 99, name: 'x.a', content: 'halt' }] }, STUDENT)).status).toBe(400);
    expect((await post('/api/submissions', { assignmentId: aid, files: [] }, STUDENT)).status).toBe(400);

    const legacy = await post('/api/submissions', { assignmentId: aid, source: files[0].content }, STUDENT);
    expect(legacy.body).toMatchObject({ score: 1, maxScore: 3 });
    expect((await get(`/api/grader/submissions/${legacy.body.id}`, ADMIN)).body.files).toMatchObject([{ name: 'submission.a', question_number: 5 }]);
  });
});
