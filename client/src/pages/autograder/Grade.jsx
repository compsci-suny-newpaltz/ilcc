/*
 * /autograder/:id — results table (per-question pass/fail chips) + a full-width
 * student drawer under it: file tabs / viewer / mapping on the left, per-question
 * results + score override on the right.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Pencil, Upload, Play, Download, Check, X, ChevronDown, ChevronRight, ChevronLeft,
  RefreshCw, Save, Bot, User, FileText, Paperclip,
} from 'lucide-react';
import Page from '../../components/Page';
import ps from '../../components/Page.module.css';
import s from './autograder.module.css';
import { api } from '../../lib/api';
import { fmtDate, fmtScore, exportUrl, fileUrl } from './util';
import ZipModal from './ZipModal';

const statusBadge = (st) => ({ graded: ps.badgeOk, error: ps.badgeErr, grading: ps.badgeWarn }[st] || '');
const inField = (t) => { const tag = t?.tagName; return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable; };

/* Per-question chip state: 'pass' (all cases passed), 'fail' (graded, some failed / no file), 'none' (not graded). */
const qState = (q) => {
  const rs = q.results || [];
  if (!rs.length) return 'none';
  return rs.every((r) => r.passed) ? 'pass' : 'fail';
};

export default function Grade() {
  const { id } = useParams();
  const [a, setA] = useState(null);
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(null);       // submission_id
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState('name');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [zip, setZip] = useState(false);
  const [offerGrade, setOfferGrade] = useState(false);
  const drawerRef = useRef(null);

  const loadA = useCallback(() => api(`/grader/assignments/${id}`).then(setA), [id]);
  const loadRows = useCallback(() => api(`/grader/assignments/${id}/results`).then((r) => setRows(r || [])), [id]);
  useEffect(() => {
    setErr('');
    Promise.all([loadA(), loadRows()]).catch((e) => setErr(e.message));
  }, [loadA, loadRows]);

  const questions = useMemo(() => [...(a?.questions || [])].sort((x, y) => (x.number ?? 0) - (y.number ?? 0)), [a]);
  const caseCount = questions.reduce((n, q) => n + (q.testCases?.length || 0), 0);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let v = rows;
    if (q) v = v.filter((r) => [r.student_name, r.student_email, r.org_defined_id].some((x) => (x || '').toLowerCase().includes(q)));
    const byName = (x, y) => (x.student_name || x.student_email || '').localeCompare(y.student_name || y.student_email || '');
    v = [...v].sort((x, y) => {
      if (sort === 'score') return (y.score ?? -1) - (x.score ?? -1) || byName(x, y);
      if (sort === 'scoreAsc') return (x.score ?? -1) - (y.score ?? -1) || byName(x, y);
      return byName(x, y);
    });
    return v;
  }, [rows, filter, sort]);

  const current = rows.find((r) => r.submission_id === sel) || null;
  const idx = visible.findIndex((r) => r.submission_id === sel);
  const go = useCallback((d) => {
    const i = visible.findIndex((r) => r.submission_id === sel);
    const n = visible[(i < 0 ? (d > 0 ? -1 : visible.length) : i) + d];
    if (n) setSel(n.submission_id);
  }, [visible, sel]);

  // ←/→ (and j/k) navigation; ignored while typing or when the modal is open
  useEffect(() => {
    const h = (e) => {
      if (zip || inField(e.target)) return;
      if (e.key === 'ArrowRight' || e.key === 'j') { go(1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' || e.key === 'k') { go(-1); e.preventDefault(); }
      else if (e.key === 'Escape' && sel != null) setSel(null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [go, zip, sel]);

  useEffect(() => {
    if (sel != null && drawerRef.current) drawerRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [sel]);

  const run = async (label, fn) => {
    setBusy(label); setErr(''); setMsg('');
    try { await fn(); } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const gradeAll = () => run('gradeAll', async () => {
    const r = await api(`/grader/assignments/${id}/grade-all`, { method: 'POST' });
    setMsg(`Graded ${r.graded}/${r.total}${r.errors ? `, ${r.errors} error(s)` : ''}.`);
    setOfferGrade(false);
    await Promise.all([loadRows(), loadA()]);
  });
  const gradeOne = () => current && run('gradeOne', async () => {
    await api(`/grader/submissions/${current.submission_id}/grade`, { method: 'POST' });
    await loadRows();
  });

  const actions = a && (
    <div className={s.actions}>
      <Link to={`/autograder/${id}/edit`} className={ps.btn}><Pencil size={13} /> Edit</Link>
      <button className={ps.btn} onClick={() => setZip(true)}><Upload size={13} /> Upload zip</button>
      <button className={ps.btn} onClick={gradeAll} disabled={!!busy || rows.length === 0}>
        {busy === 'gradeAll' ? <span className={ps.spinner} /> : <Play size={13} />} Grade all
      </button>
      <a className={ps.btn} href={exportUrl(id)} download><Download size={13} /> Export CSV</a>
    </div>
  );

  return (
    <Page title={a ? a.title : 'Grade'} wide actions={actions}>
      {err && <div className={s.error}>{err}</div>}
      {!a && !err && <div className={ps.empty}><span className={ps.spinner} /></div>}
      {a && (
        <>
          <div className={s.header}>
            <div className={s.headerLeft}>
              <h2>{a.title}</h2>
              {a.chapter != null && <span className={ps.badge}>ch. {a.chapter}</span>}
              <span className={`${ps.badge} ${a.is_open ? ps.badgeOk : ''}`}>{a.is_open ? 'open' : 'closed'}</span>
              <span className={`${ps.small} ${ps.muted}`}>due {fmtDate(a.due_at)} · {questions.length} question{questions.length === 1 ? '' : 's'} · {caseCount} test cases · {rows.length} submissions</span>
            </div>
            {msg && <span className={`${ps.small} ${ps.muted}`}>{msg}</span>}
          </div>
          {offerGrade && (
            <div className={ps.callout}>
              <Play size={16} className={ps.calloutIcon} />
              <div className={ps.cardRow} style={{ flex: 1 }}>
                <span>Submissions imported. Run the autograder on everything now?</span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button className={ps.btnPrimary} onClick={gradeAll} disabled={!!busy}>Grade all now</button>
                  <button className={ps.btn} onClick={() => setOfferGrade(false)}>Later</button>
                </span>
              </div>
            </div>
          )}

          <div className={s.listTools}>
            <input className={ps.input} placeholder="Filter students…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 280 }} />
            <select className={ps.select} value={sort} onChange={(e) => setSort(e.target.value)} title="Sort">
              <option value="name">Name</option>
              <option value="score">Score ↓</option>
              <option value="scoreAsc">Score ↑</option>
            </select>
            <span className={`${ps.small} ${ps.muted}`} style={{ marginLeft: 'auto' }}>
              click a row · <span className={s.kbd}>←</span> <span className={s.kbd}>→</span> prev / next student · <span className={s.kbd}>Esc</span> close
            </span>
          </div>

          {visible.length === 0 ? (
            <div className={`${ps.card} ${ps.empty}`}>{rows.length ? 'No matches.' : 'No submissions yet. Students can submit from the editor, or upload a Brightspace zip.'}</div>
          ) : (
            <div className={s.tableWrap}>
              <table className={`${ps.table} ${s.results}`}>
                <thead>
                  <tr>
                    <th>Student</th><th>OrgDefinedId</th><th>Submitted</th><th>Files</th><th>Questions</th><th>Score</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => (
                    <tr key={r.submission_id} className={r.submission_id === sel ? s.rowActive : ''} onClick={() => setSel(r.submission_id === sel ? null : r.submission_id)}>
                      <td><strong>{r.student_name || r.student_email || `#${r.submission_id}`}</strong></td>
                      <td className={`${ps.small} ${ps.muted}`}>{r.org_defined_id || r.student_email || ''}</td>
                      <td className={`${ps.small} ${ps.muted} ${s.num}`}>{fmtDate(r.submitted_at)}</td>
                      <td className={s.num}>{r.files?.length ?? 0}</td>
                      <td>
                        <span className={s.chips}>
                          {(r.questions || []).map((q) => {
                            const st = qState(q);
                            const rs = q.results || [];
                            const passed = rs.filter((x) => x.passed).length;
                            const title = st === 'none' ? `Q${q.number}: not graded` : `Q${q.number}: ${passed}/${rs.length} passed${q.file_id ? '' : ' (no file)'}`;
                            return (
                              <span key={q.question_id ?? q.number} title={title}
                                className={`${s.chip} ${st === 'pass' ? s.chipPass : st === 'fail' ? s.chipFail : s.chipNone}`}>
                                Q{q.number}
                              </span>
                            );
                          })}
                        </span>
                      </td>
                      <td className={`${s.score} ${s.num}`}>{fmtScore(r.score, r.max_score)}</td>
                      <td><span className={`${ps.badge} ${statusBadge(r.status)}`}>{r.status || 'pending'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {current && (
            <div className={s.drawer} ref={drawerRef}>
              <StudentPanel
                key={current.submission_id}
                row={current}
                questions={questions}
                pos={{ i: idx, n: visible.length }}
                onPrev={() => go(-1)} onNext={() => go(1)} onClose={() => setSel(null)}
                onRegrade={gradeOne} busy={busy === 'gradeOne'}
                refresh={loadRows}
              />
            </div>
          )}
        </>
      )}
      {zip && (
        <ZipModal assignmentId={id} onClose={() => setZip(false)} onImported={(n, opts) => {
          if (!opts?.keepOpen) setZip(false);
          setMsg(`Imported ${n} submission${n === 1 ? '' : 's'}.`); setOfferGrade(true);
          Promise.all([loadRows(), loadA()]).catch((e) => setErr(e.message));
        }} />
      )}
    </Page>
  );
}

/* ---------- student drawer ---------- */

function StudentPanel({ row, questions, pos, onPrev, onNext, onClose, onRegrade, busy, refresh }) {
  const files = useMemo(() => [...(row.files || [])].sort((x, y) => {
    // mapped .a files first (by question number), then other .a, then attachments by name
    const qx = x.question_number ?? 1e9; const qy = y.question_number ?? 1e9;
    if (qx !== qy) return qx - qy;
    const ax = x.ext === 'a' ? 0 : 1; const ay = y.ext === 'a' ? 0 : 1;
    return ax - ay || (x.name || '').localeCompare(y.name || '');
  }), [row.files]);
  const [fid, setFid] = useState(files[0]?.id ?? null);
  const [mapErr, setMapErr] = useState('');
  const [mapping, setMapping] = useState(false);
  const file = files.find((f) => f.id === fid) || files[0] || null;

  const remap = async (questionId) => {
    if (!file) return;
    setMapping(true); setMapErr('');
    try {
      await api(`/grader/submissions/${row.submission_id}/files/${file.id}`, { method: 'PUT', body: { questionId } });
      await refresh();
    } catch (e) { setMapErr(e.message); } finally { setMapping(false); }
  };

  return (
    <>
      <div className={s.drawerHead}>
        <h3>{row.student_name || row.student_email || `#${row.submission_id}`}</h3>
        <span className={`${ps.small} ${ps.muted}`}>{row.org_defined_id || row.student_email || ''}</span>
        <span className={`${ps.small} ${ps.muted}`}>submitted {fmtDate(row.submitted_at)}</span>
        <span className={s.score}>{fmtScore(row.score, row.max_score)}</span>
        <span className={`${ps.badge} ${statusBadge(row.status)}`}>{row.status || 'pending'}</span>
        <div className={s.drawerNav}>
          <button className={ps.btn} onClick={onRegrade} disabled={busy}>{busy ? <span className={ps.spinner} /> : <RefreshCw size={13} />} Re-grade this student</button>
          <button className={ps.btn} onClick={onPrev} disabled={pos.i <= 0} title="Previous student (←)"><ChevronLeft size={14} /> Prev</button>
          <span className={`${ps.small} ${ps.muted} ${s.num}`}>{pos.i + 1} / {pos.n}</span>
          <button className={ps.btn} onClick={onNext} disabled={pos.i < 0 || pos.i >= pos.n - 1} title="Next student (→)">Next <ChevronRight size={14} /></button>
          <button className={s.iconBtn} onClick={onClose} aria-label="Close" title="Close (Esc)"><X size={14} /></button>
        </div>
      </div>

      <div className={s.drawerBody}>
        <div style={{ minWidth: 0 }}>
          {files.length === 0 ? <div className={`${ps.card} ${ps.empty}`}>No files in this submission.</div> : (
            <>
              <div className={s.fileTabs} role="tablist">
                {files.map((f) => (
                  <button key={f.id} role="tab" aria-selected={f.id === file?.id} type="button"
                    className={`${s.fileTab} ${f.id === file?.id ? s.fileTabActive : ''}`} onClick={() => setFid(f.id)} title={f.name}>
                    <span>{f.name}</span>
                    <span className={s.extBadge}>{f.ext || '?'}</span>
                    {f.question_number != null && <span className={s.qBadge}>Q{f.question_number}</span>}
                  </button>
                ))}
              </div>
              {file && (
                <>
                  <div className={s.viewerBar}>
                    {file.ext === 'a' ? <FileText size={14} className={ps.muted} /> : <Paperclip size={14} className={ps.muted} />}
                    <span className={ps.muted}>{file.mime || ''}{file.size != null ? ` · ${file.size.toLocaleString()} B` : ''}</span>
                    {file.ext === 'a' && (
                      <label className={ps.small} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        Map to
                        <select className={ps.select} value={file.question_id ?? ''} disabled={mapping} onChange={(e) => remap(e.target.value === '' ? null : Number(e.target.value))}>
                          {questions.map((q) => <option key={q.id} value={q.id}>Q{q.number}{q.title ? ` — ${q.title}` : ''}</option>)}
                          <option value="">attachment (not graded)</option>
                        </select>
                        {mapping && <span className={ps.spinner} />}
                      </label>
                    )}
                    <a className={ps.btn} href={fileUrl(row.submission_id, file.id)} download={file.name} style={{ padding: '3px 8px', marginLeft: file.ext === 'a' ? 0 : 'auto' }}><Download size={12} /> Download</a>
                  </div>
                  {mapErr && <div className={s.error}>{mapErr}</div>}
                  <FileViewer key={file.id} submissionId={row.submission_id} file={file} />
                </>
              )}
            </>
          )}

          <h3 className={ps.h3}>Test results</h3>
          {(row.questions || []).length === 0 ? <div className={`${ps.card} ${ps.empty}`}>This assignment has no questions.</div>
            : (row.questions || []).map((q) => <QuestionResults key={q.question_id ?? q.number} q={q} files={files} onPick={setFid} />)}
        </div>

        <GradePanel row={row} onSaved={refresh} />
      </div>
    </>
  );
}

function FileViewer({ submissionId, file }) {
  const url = fileUrl(submissionId, file.id);
  const [text, setText] = useState(null);
  const [err, setErr] = useState('');
  const isText = !!file.is_text;
  useEffect(() => {
    if (!isText) return undefined;
    let live = true;
    api(`/grader/submissions/${submissionId}/files/${file.id}`, { raw: true })
      .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); const t = await r.text(); if (live) setText(t); })
      .catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [submissionId, file.id, isText]);

  if (isText) {
    if (err) return <div className={s.error}>Could not load file: {err}</div>;
    if (text === null) return <div className={ps.empty}><span className={ps.spinner} /></div>;
    return (
      <pre className={`${ps.pre} ${s.source} ${s.viewer}`}>
        <div className={s.lineWrap}>
          {text.replace(/\n$/, '').split('\n').map((l, i) => <div key={i} className={s.line}><span>{l || ' '}</span></div>)}
        </div>
      </pre>
    );
  }
  if (file.ext === 'pdf') return <iframe title={file.name} src={url} className={s.frame} style={{ height: '70vh' }} />;
  return (
    <div className={s.dl}>
      <Paperclip size={22} />
      <span>{file.name} is a binary file ({file.ext || 'unknown'}) — no preview.</span>
      <a className={ps.btnPrimary} href={url} download={file.name}><Download size={14} /> Download</a>
    </div>
  );
}

function QuestionResults({ q, files, onPick }) {
  const rs = q.results || [];
  const passed = rs.filter((r) => r.passed).length;
  const file = q.file_id != null ? files.find((f) => f.id === q.file_id) : null;
  const st = qState(q);
  return (
    <div className={s.qResult}>
      <div className={s.qResultHead}>
        <span className={`${s.chip} ${st === 'pass' ? s.chipPass : st === 'fail' ? s.chipFail : s.chipNone}`}>Q{q.number}</span>
        <strong>{q.title || `Question ${q.number}`}</strong>
        {file ? (
          <button type="button" className={`${ps.code} ${s.fileLink}`} onClick={() => onPick(file.id)} title="Show this file" style={{ cursor: 'pointer' }}>{file.name}</button>
        ) : <span className={`${ps.badge} ${ps.badgeErr}`}>no file mapped</span>}
        <span className={`${ps.small} ${ps.muted}`} style={{ marginLeft: 'auto' }}>
          {rs.length ? `${passed}/${rs.length} passed · ${fmtScore(q.score, q.max)}` : 'not graded'}
        </span>
      </div>
      {rs.length > 0 && <div className={s.cases}>{rs.map((t) => <Case key={t.test_case_id ?? t.name} t={t} />)}</div>}
    </div>
  );
}

function Case({ t }) {
  const [open, setOpen] = useState(!t.passed);
  const hasBody = !t.passed || t.error;
  return (
    <div className={s.case}>
      <div className={s.caseHead} onClick={() => hasBody && setOpen((o) => !o)}>
        {hasBody ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span style={{ width: 14 }} />}
        {t.passed ? <Check size={15} className={s.pass} /> : <X size={15} className={s.fail} />}
        <strong>{t.name || t.test_name}</strong>
        <span className={`${ps.small} ${ps.muted}`}>w {t.weight}</span>
        {t.runtime_ms != null && <span className={`${ps.small} ${ps.muted}`}>{t.runtime_ms} ms</span>}
      </div>
      {hasBody && open && (
        <div className={s.caseBody}>
          {t.error && <pre className={s.errBox}>{t.error}</pre>}
          {t.diff?.length > 0 && (
            <table className={s.diff}>
              <thead><tr><th>line</th><th>expected</th><th>actual</th></tr></thead>
              <tbody>
                {t.diff.map((d, i) => (
                  <tr key={i}>
                    <td>{d.line}</td>
                    <td className={s.diffExp}>{d.expected ?? <i className={ps.muted}>(none)</i>}</td>
                    <td className={s.diffAct}>{d.actual ?? <i className={ps.muted}>(none)</i>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!t.passed && !t.diff?.length && t.actual_stdout != null && (
            <><div className={ps.label}>actual stdout</div><pre className={ps.pre} style={{ margin: 0 }}>{t.actual_stdout || '(empty)'}</pre></>
          )}
        </div>
      )}
    </div>
  );
}

function GradePanel({ row, onSaved }) {
  const [score, setScore] = useState(row.score ?? '');
  const [feedback, setFeedback] = useState(row.feedback || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const timer = useRef();

  // Re-grade / remap changes the row → reflect the new autograded score unless the TA is mid-edit.
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) { setScore(row.score ?? ''); setFeedback(row.feedback || ''); } }, [row.score, row.feedback]);

  const save = async (e) => {
    e?.preventDefault();
    setSaving(true); setErr(''); setSaved(false);
    try {
      await api(`/grader/submissions/${row.submission_id}/grade`, { method: 'PUT', body: { score: score === '' ? null : Number(score), feedback } });
      dirty.current = false;
      setSaved(true); clearTimeout(timer.current); timer.current = setTimeout(() => setSaved(false), 2000);
      await onSaved();
    } catch (ex) { setErr(ex.message); } finally { setSaving(false); }
  };

  const byBot = !row.graded_by_email || row.graded_by_email === 'autograder';
  return (
    <form className={`${ps.card} ${s.panel}`} onSubmit={save}>
      <h3 className={ps.h3} style={{ marginTop: 0 }}>Grade</h3>
      <label className={ps.label} style={{ marginTop: 0 }}>Score <span className={ps.muted}>/ {row.max_score ?? '?'}</span></label>
      <input className={ps.input} type="number" step="any" min="0" max={row.max_score ?? undefined} value={score} onChange={(e) => { dirty.current = true; setScore(e.target.value); }} />
      <label className={ps.label}>Feedback</label>
      <textarea className={ps.textarea} rows={8} value={feedback} onChange={(e) => { dirty.current = true; setFeedback(e.target.value); }} placeholder="Shown to the student and exported to Brightspace." />
      {err && <div className={s.error}>{err}</div>}
      <div className={s.panelRow} style={{ marginTop: 12 }}>
        <button type="submit" className={ps.btnPrimary} disabled={saving}>{saving ? <span className={ps.spinner} /> : <Save size={14} />} Save</button>
        {saved && <span className={`${ps.small} ${s.pass}`}>Saved</span>}
      </div>
      <p className={`${ps.small} ${ps.muted}`} style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        {row.graded_at ? (
          byBot ? <><Bot size={13} /> graded by autograder</> : <><User size={13} /> graded by {row.graded_by_email}</>
        ) : 'not graded yet'}
      </p>
      {row.graded_at && <p className={`${ps.small} ${ps.muted}`} style={{ marginTop: 2 }}>{fmtDate(row.graded_at)}</p>}
    </form>
  );
}
