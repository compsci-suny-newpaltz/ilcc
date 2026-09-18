import { useEffect, useState } from 'react';
import Page from '../../components/Page';
import ps from '../../components/Page.module.css';
import styles from './Labs.module.css';
import { api } from '../../lib/api';
import { textbookSources, textbookChapters } from '../../data/textbookSources';
import { Plus, Pencil, FileCode2, ArrowUp, ArrowDown, X, BookOpen, Save } from 'lucide-react';

function LabForm({ lab, onSaved, onCancel }) {
  const [title, setTitle] = useState(lab?.title || '');
  const [instructions, setInstructions] = useState(lab?.instructions || '');
  const [files, setFiles] = useState(lab?.files || []);
  const [isPublished, setPublished] = useState(lab?.isPublished || false);
  const [chapter, setChapter] = useState(String(textbookChapters[0]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const move = (index, direction) => {
    setFiles(previous => {
      const next = [...previous];
      [next[index], next[index + direction]] = [next[index + direction], next[index]];
      return next;
    });
  };

  const save = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = await api(lab ? `/labs/admin/${lab.id}` : '/labs/admin', {
        method: lab ? 'PUT' : 'POST', body: { title, instructions, files, isPublished },
      });
      onSaved(saved);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <form className={`${ps.card} ${styles.form}`} onSubmit={save} aria-label="Lab configuration">
      <div className={styles.formHead}>
        <h2><BookOpen size={18} />{lab ? 'Edit lab' : 'New lab'}</h2>
        <span className={`${ps.badge} ${isPublished ? ps.badgeOk : ''}`}>{isPublished ? 'Published' : 'Draft'}</span>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <fieldset className={styles.fields} disabled={busy}>
        <label className={ps.label} htmlFor="lab-title">Lab name</label>
        <input id="lab-title" className={ps.input} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} />
        <label className={ps.label} htmlFor="lab-instructions">Instructions (optional)</label>
        <textarea id="lab-instructions" className={ps.textarea} maxLength={20000} value={instructions} onChange={e => setInstructions(e.target.value)} />
        <div className={styles.fileColumns}>
        <section className={styles.fileSection} aria-label="Textbook catalog">
        <h3>Textbook sources</h3>
        <label className={ps.label} htmlFor="lab-chapter">Choose textbook files by chapter</label>
        <select id="lab-chapter" className={ps.select} value={chapter} onChange={e => setChapter(e.target.value)}>
          {textbookChapters.map(number => <option key={number} value={number}>Chapter {number}</option>)}
        </select>
        <div className={styles.catalog}>
          {textbookSources.filter(source => source.chapter === Number(chapter)).map(source => (
            <label className={styles.sourceOption} key={source.name}>
              <input type="checkbox" checked={files.includes(source.name)} onChange={e => {
                setFiles(previous => e.target.checked ? [...previous, source.name] : previous.filter(name => name !== source.name));
              }} /> <FileCode2 size={14} />{source.name}
            </label>
          ))}
        </div>
        <p className={`${ps.small} ${ps.muted}`}>Select files from one or more chapters.</p>
        </section>
        <section className={styles.fileSection} aria-label="Selected sources">
        <h3>Selected files <span className={ps.badge}>{files.length}</span></h3>
        <p className={`${ps.small} ${ps.muted}`}>Students receive files in this order.</p>
        {!files.length && <div className={styles.emptySelection}><FileCode2 size={24} /><p>Select at least one textbook file.</p></div>}
        <ol className={styles.selected}>
          {files.map((name, index) => <li key={name}>
            <span className={styles.fileName}>{name}<small>→ {name.replace(/\.c$/, '.a')}</small></span>
            <div className={styles.actions}>
              <button type="button" className={`${ps.btn} ${styles.iconBtn}`} disabled={index === 0} title="Move up" aria-label={`Move ${name} up`} onClick={() => move(index, -1)}><ArrowUp size={14} /></button>
              <button type="button" className={`${ps.btn} ${styles.iconBtn}`} disabled={index === files.length - 1} title="Move down" aria-label={`Move ${name} down`} onClick={() => move(index, 1)}><ArrowDown size={14} /></button>
              <button type="button" className={`${ps.btn} ${styles.iconBtn}`} title="Remove file" aria-label={`Remove ${name}`} onClick={() => setFiles(previous => previous.filter(file => file !== name))}><X size={14} /></button>
            </div>
          </li>)}
        </ol>
        </section>
        </div>
        <label className={styles.publish}><input type="checkbox" checked={isPublished} onChange={e => setPublished(e.target.checked)} /> Published — available to students</label>
        <p className={ps.muted}>Uncheck to save as a draft. Changes apply when students next import the lab.</p>
        <div className={styles.formFooter}>
          <button type="button" className={ps.btn} onClick={onCancel}>Cancel</button>
          <button type="submit" className={ps.btnPrimary} disabled={!title.trim() || !files.length}><Save size={14} />{busy ? 'Saving…' : 'Save lab'}</button>
        </div>
      </fieldset>
    </form>
  );
}

export default function Labs() {
  const [labs, setLabs] = useState(null);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api('/labs/admin').then(rows => { if (active) setLabs(rows); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, []);

  const saved = lab => {
    setLabs(previous => previous.some(row => row.id === lab.id)
      ? previous.map(row => row.id === lab.id ? lab : row) : [...previous, lab]);
    setEditing(null);
  };

  return (
    <Page title="Lab Configuration" subtitle="Choose textbook sources, set their opening order, and publish labs for students." wide
      actions={<button className={ps.btnPrimary} onClick={() => setEditing({})} disabled={!labs || editing !== null}><Plus size={14} />New lab</button>}>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {labs === null && !error && <div className={ps.empty}><span className={ps.spinner} /> Loading labs…</div>}
      {labs && <>
        {editing !== null && <LabForm key={editing.id || 'new'} lab={editing.id ? editing : null} onSaved={saved} onCancel={() => setEditing(null)} />}
        {!labs.length && editing === null && <div className={`${ps.card} ${ps.empty}`}><BookOpen size={32} /><p className={ps.p}><strong>No labs yet</strong></p><p className={ps.muted}>Create a lab and select its textbook files. Published labs appear in the editor’s Import menu.</p></div>}
        <div className={styles.labList}>
        {labs.map(lab => <div key={lab.id} className={`${ps.card} ${styles.labCard}`}>
          <div className={styles.labSummary}><div className={styles.labTitle}><BookOpen size={17} /><strong>{lab.title}</strong> <span className={`${ps.badge} ${lab.isPublished ? ps.badgeOk : ''}`}>{lab.isPublished ? 'Published' : 'Draft'}</span></div>
            <p className={`${ps.small} ${ps.muted}`}>{lab.files.length} {lab.files.length === 1 ? 'file' : 'files'}</p>
            <div className={styles.fileChips}>{lab.files.map(name => <span className={ps.code} key={name}>{name}</span>)}</div>
          </div>
          <button className={ps.btn} disabled={editing !== null} onClick={() => setEditing(lab)}><Pencil size={13} />Edit</button>
        </div>)}
        </div>
      </>}
    </Page>
  );
}
