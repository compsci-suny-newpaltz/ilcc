/* Collapsible "How the autograder works & setup" explainer (top of /autograder). */
import { useState } from 'react';
import { ChevronDown, ChevronRight, CircleHelp } from 'lucide-react';
import ps from '../../components/Page.module.css';
import s from './autograder.module.css';

const KEY = 'ilcc.autograder.howto.v1';
const readOpen = () => { try { return localStorage.getItem(KEY) !== 'collapsed'; } catch { return true; } };

const C = ({ children }) => <code className={ps.code}>{children}</code>;

const STEPS = [
  ['Create an assignment', <>Title, chapter, due date. Toggle <i>Open for submissions</i> to let students submit from the editor.</>],
  ['Add a question per graded program', <>The question <b>number</b> is what students put in their filenames — question 5 ⇒ <C>lab4q5.a</C>. One program per question.</>],
  ['Add test cases to each question', <>Each case has <b>stdin</b> (one line per <C>din</C>/<C>sin</C>/<C>ain</C>) and the <b>expected stdout</b>. Tip: run your reference solution in the editor with that input and paste its output.</>],
  ['Collect submissions', <>Brightspace → Assignments → the assignment → <b>Download all submissions</b>. On the grade page click <b>Upload zip</b>.</>],
  ['Check the mapping matrix', <>Rows are students, columns are questions. Each cell shows which <C>.a</C> file will be graded for that question — fix any <span className={`${ps.badge} ${ps.badgeWarn}`}>guessed</span> or <span className={`${ps.badge} ${ps.badgeErr}`}>missing</span> cell, then <b>Import</b>.</>],
  ['Grade all', <>Runs every question's test cases against the mapped file for every student. Score = sum of the weights of passed cases across all questions.</>],
  ['Review', <>Click a student to see every file they submitted, per-question results with an expected/actual diff, remap a file to another question, re-grade, or override the score and add feedback.</>],
  ['Export', <><b>Export CSV</b> → Brightspace → Grades → Import. The CSV uses OrgDefinedId so it lines up with the gradebook.</>],
];

export default function HowItWorks() {
  const [open, setOpen] = useState(readOpen);
  const toggle = () => setOpen((o) => { try { localStorage.setItem(KEY, o ? 'collapsed' : 'open'); } catch { /* ignore */ } return !o; });

  return (
    <div className={`${ps.card} ${s.howto}`}>
      <button type="button" className={s.howtoHead} onClick={toggle} aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <CircleHelp size={16} className={ps.calloutIcon} style={{ marginTop: 0 }} />
        <span>How the autograder works &amp; setup</span>
        {!open && <span className={`${ps.small} ${ps.muted}`}>— assignment → questions → test cases → Brightspace zip → grade → CSV</span>}
      </button>
      {open && (
        <div className={s.howtoBody}>
          <ol className={s.steps}>
            {STEPS.map(([t, body], i) => (
              <li key={i}><b>{t}.</b> <span className={ps.muted}>{body}</span></li>
            ))}
          </ol>
          <div className={s.naming}>
            <div className={s.namingTitle}>File naming for students</div>
            <p className={`${ps.p} ${ps.small}`} style={{ marginBottom: 8 }}>
              Programs must be <C>.a</C> files whose name contains the question number: <C>&lt;anything&gt;q&lt;N&gt;.a</C>.
            </p>
            <div className={s.namingCols}>
              <div>
                <div className={`${ps.small} ${ps.muted}`}>Detected automatically</div>
                <div className={s.exList}>
                  {['lab4q5.a', 'ch3p12.a', 'Q17.a', '3-5.a', 'lab4ex0305.a'].map((n) => <C key={n}>{n}</C>)}
                </div>
              </div>
              <div>
                <div className={`${ps.small} ${ps.muted}`}>Not graded, but viewable in the student panel</div>
                <div className={s.exList}>{['.txt', '.pdf', '.docx'].map((n) => <C key={n}>{n}</C>)}</div>
              </div>
            </div>
            <p className={`${ps.p} ${ps.small} ${ps.muted}`} style={{ margin: '8px 0 0' }}>
              Nothing is lost if a student names a file oddly — TAs can fix any mapping in the import matrix or on the student panel.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
