/* /autograder/new and /autograder/:id/edit — assignment + questions + test case editor. */
import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { Plus, Trash2, ArrowUp, ArrowDown, Info, Save } from 'lucide-react';
import Page from '../../components/Page';
import ps from '../../components/Page.module.css';
import s from './autograder.module.css';
import { api } from '../../lib/api';
import { toLocalInput } from './util';

const blankCase = () => ({ name: '', stdin: '', expected_stdout: '', weight: 1 });
const blankQuestion = (number = 1) => ({ id: null, number, title: '', description: '', testCases: [blankCase()] });

/* GET /assignments/:id → editable questions[]; legacy testCases at top level → question 1. */
function fromServer(a) {
  const byOrd = (x, y) => (x.ordinal ?? 0) - (y.ordinal ?? 0);
  const caseOf = (t) => ({ name: t.name || '', stdin: t.stdin || '', expected_stdout: t.expected_stdout || '', weight: t.weight ?? 1 });
  const qs = [...(a.questions || [])].sort(byOrd).map((q) => ({
    id: q.id ?? null, number: q.number ?? 1, title: q.title || '', description: q.description || '',
    testCases: [...(q.testCases || [])].sort(byOrd).map(caseOf),
  }));
  if (qs.length) return qs.map((q) => (q.testCases.length ? q : { ...q, testCases: [blankCase()] }));
  const legacy = [...(a.testCases || [])].sort(byOrd).map(caseOf);
  return [{ ...blankQuestion(1), testCases: legacy.length ? legacy : [blankCase()] }];
}

export default function AssignmentForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const editing = !!id;
  const [form, setForm] = useState({ title: '', chapter: '', description: '', due_at: '', is_open: true });
  const [questions, setQuestions] = useState([blankQuestion(1)]);
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!editing) return;
    api(`/grader/assignments/${id}`).then((a) => {
      setForm({ title: a.title || '', chapter: a.chapter ?? '', description: a.description || '', due_at: toLocalInput(a.due_at), is_open: !!a.is_open });
      setQuestions(fromServer(a));
    }).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, [id, editing]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setQ = (qi, k, v) => setQuestions((qs) => qs.map((q, j) => (j === qi ? { ...q, [k]: v } : q)));
  const setCases = (qi, fn) => setQuestions((qs) => qs.map((q, j) => (j === qi ? { ...q, testCases: fn(q.testCases) } : q)));
  const setCase = (qi, i, k, v) => setCases(qi, (cs) => cs.map((c, j) => (j === i ? { ...c, [k]: v } : c)));
  const moveCase = (qi, i, d) => setCases(qi, (cs) => {
    const j = i + d; if (j < 0 || j >= cs.length) return cs;
    const n = [...cs]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const removeCase = (qi, i) => setCases(qi, (cs) => (cs.length > 1 ? cs.filter((_, j) => j !== i) : cs));
  const addCase = (qi) => setCases(qi, (cs) => [...cs, blankCase()]);

  const addQuestion = () => setQuestions((qs) => {
    const next = qs.reduce((m, q) => Math.max(m, Number(q.number) || 0), 0) + 1;
    return [...qs, blankQuestion(next)];
  });
  const removeQuestion = (qi) => setQuestions((qs) => {
    if (qs.length === 1) return qs;
    const q = qs[qi];
    const n = q.testCases.filter((c) => c.stdin || c.expected_stdout).length;
    if (n && !window.confirm(`Remove question ${q.number} and its ${n} test case${n === 1 ? '' : 's'}?`)) return qs;
    return qs.filter((_, j) => j !== qi);
  });
  const moveQuestion = (qi, d) => setQuestions((qs) => {
    const j = qi + d; if (j < 0 || j >= qs.length) return qs;
    const n = [...qs]; [n[qi], n[j]] = [n[j], n[qi]]; return n;
  });

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!form.title.trim()) { setErr('Title is required.'); return; }
    const nums = questions.map((q) => Number(q.number));
    if (nums.some((n) => !Number.isInteger(n) || n < 0)) { setErr('Every question needs a whole-number question number.'); return; }
    if (new Set(nums).size !== nums.length) { setErr('Question numbers must be unique.'); return; }
    const body = {
      title: form.title.trim(),
      chapter: form.chapter === '' ? null : Number(form.chapter),
      description: form.description || null,
      due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      is_open: !!form.is_open,
      questions: questions.map((q, qi) => ({
        ...(q.id != null ? { id: q.id } : {}),
        number: Number(q.number), title: q.title.trim() || null, description: q.description || null, ordinal: qi,
        testCases: q.testCases.map((c, i) => ({
          name: c.name.trim() || `Test ${i + 1}`, stdin: c.stdin, expected_stdout: c.expected_stdout,
          weight: Number(c.weight) || 1, ordinal: i,
        })),
      })),
    };
    setSaving(true);
    try {
      const r = editing
        ? await api(`/grader/assignments/${id}`, { method: 'PUT', body })
        : await api('/grader/assignments', { method: 'POST', body });
      nav(`/autograder/${editing ? id : r.id}`);
    } catch (ex) { setErr(ex.message); } finally { setSaving(false); }
  };

  const totalCases = questions.reduce((a, q) => a + q.testCases.length, 0);
  const totalWeight = questions.reduce((a, q) => a + q.testCases.reduce((b, c) => b + (Number(c.weight) || 0), 0), 0);

  return (
    <Page title={editing ? 'Edit assignment' : 'New assignment'} wide>
      {loading ? <div className={ps.empty}><span className={ps.spinner} /></div> : (
        <form onSubmit={submit}>
          {err && <div className={s.error}>{err}</div>}
          <div className={ps.card}>
            <label className={ps.label} style={{ marginTop: 0 }}>Title</label>
            <input className={ps.input} value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Lab 6 — Loops" required />
            <div className={s.formRow}>
              <div>
                <label className={ps.label}>Chapter</label>
                <input className={ps.input} type="number" min="0" value={form.chapter} onChange={(e) => set('chapter', e.target.value)} placeholder="6" />
              </div>
              <div>
                <label className={ps.label}>Due</label>
                <input className={ps.input} type="datetime-local" value={form.due_at} onChange={(e) => set('due_at', e.target.value)} />
              </div>
            </div>
            <label className={ps.label}>Description</label>
            <textarea className={ps.textarea} style={{ fontFamily: 'inherit', fontSize: 13.5 }} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Shown to students in the editor." />
            <label className={s.check}>
              <input type="checkbox" checked={form.is_open} onChange={(e) => set('is_open', e.target.checked)} />
              Open for submissions
            </label>
          </div>

          <h2 className={ps.h2}>Questions <span className={`${ps.muted} ${ps.small}`}>({questions.length} question{questions.length === 1 ? '' : 's'}, {totalCases} test case{totalCases === 1 ? '' : 's'}, total weight {totalWeight})</span></h2>
          <div className={ps.callout}>
            <Info size={16} className={ps.calloutIcon} />
            <div>
              One question per graded program. The <b>number</b> is what students put in the filename — question 5 ⇒ <code className={ps.code}>lab4q5.a</code>.
              stdin lines are fed one per <code className={ps.code}>din</code>/<code className={ps.code}>sin</code>/<code className={ps.code}>ain</code>;
              expected output is compared with trailing whitespace ignored; the input is <b>not</b> echoed into the output for grading.
            </div>
          </div>

          {questions.map((q, qi) => (
            <div key={q.id ?? `new-${qi}`} className={`${ps.card} ${s.question}`}>
              <div className={s.qHead}>
                <span className={s.qNum}>Q</span>
                <input type="number" className={ps.input} min="0" step="1" value={q.number} onChange={(e) => setQ(qi, 'number', e.target.value)} title="Question number (used in filenames)" aria-label="Question number" />
                <input type="text" className={ps.input} value={q.title} onChange={(e) => setQ(qi, 'title', e.target.value)} placeholder={`Question ${q.number} title (optional)`} aria-label="Question title" />
                <button type="button" className={s.iconBtn} onClick={() => moveQuestion(qi, -1)} disabled={qi === 0} title="Move up"><ArrowUp size={14} /></button>
                <button type="button" className={s.iconBtn} onClick={() => moveQuestion(qi, 1)} disabled={qi === questions.length - 1} title="Move down"><ArrowDown size={14} /></button>
                <button type="button" className={s.iconBtn} onClick={() => removeQuestion(qi)} disabled={questions.length === 1} title="Remove question"><Trash2 size={14} /></button>
              </div>
              <textarea className={ps.textarea} rows={2} style={{ fontFamily: 'inherit', fontSize: 13, minHeight: 40 }} value={q.description} onChange={(e) => setQ(qi, 'description', e.target.value)} placeholder="Description (optional)" />

              <div className={s.qCases}>
                {q.testCases.map((c, i) => (
                  <div key={i} className={s.tc}>
                    <div className={s.tcHead}>
                      <span className={`${ps.muted} ${ps.small}`}>#{i + 1}</span>
                      <input type="text" className={ps.input} value={c.name} onChange={(e) => setCase(qi, i, 'name', e.target.value)} placeholder={`Test ${i + 1}`} />
                      <label className={`${ps.small} ${ps.muted}`}>weight</label>
                      <input type="number" className={ps.input} min="0" step="any" value={c.weight} onChange={(e) => setCase(qi, i, 'weight', e.target.value)} />
                      <button type="button" className={s.iconBtn} onClick={() => moveCase(qi, i, -1)} disabled={i === 0} title="Move up"><ArrowUp size={14} /></button>
                      <button type="button" className={s.iconBtn} onClick={() => moveCase(qi, i, 1)} disabled={i === q.testCases.length - 1} title="Move down"><ArrowDown size={14} /></button>
                      <button type="button" className={s.iconBtn} onClick={() => removeCase(qi, i)} disabled={q.testCases.length === 1} title="Remove"><Trash2 size={14} /></button>
                    </div>
                    <div className={s.tcRow}>
                      <div>
                        <label className={ps.label}>stdin</label>
                        <textarea className={ps.textarea} value={c.stdin} onChange={(e) => setCase(qi, i, 'stdin', e.target.value)} placeholder="one input per line" spellCheck={false} />
                      </div>
                      <div>
                        <label className={ps.label}>expected stdout</label>
                        <textarea className={ps.textarea} value={c.expected_stdout} onChange={(e) => setCase(qi, i, 'expected_stdout', e.target.value)} placeholder="exact program output" spellCheck={false} />
                      </div>
                    </div>
                  </div>
                ))}
                <button type="button" className={ps.btn} onClick={() => addCase(qi)}><Plus size={14} /> Add test case</button>
              </div>
            </div>
          ))}
          <button type="button" className={ps.btn} onClick={addQuestion}><Plus size={14} /> Add question</button>

          <div className={ps.cardRow} style={{ marginTop: 20, justifyContent: 'flex-end' }}>
            <Link to={editing ? `/autograder/${id}` : '/autograder'} className={ps.btn}>Cancel</Link>
            <button type="submit" className={ps.btnPrimary} disabled={saving}>
              {saving ? <span className={ps.spinner} /> : <Save size={14} />} {editing ? 'Save changes' : 'Create assignment'}
            </button>
          </div>
        </form>
      )}
    </Page>
  );
}
