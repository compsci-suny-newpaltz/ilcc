import { useEffect, useState } from 'react';
import Page from '../../components/Page';
import ps from '../../components/Page.module.css';
import styles from './Labs.module.css';
import { api } from '../../lib/api';
import { textbookSources, textbookChapters } from '../../data/textbookSources';

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
    <form className={ps.card} onSubmit={save} aria-label="Lab configuration">
      <h2 className={ps.h2}>{lab ? 'Edit lab' : 'New lab'}</h2>
      {error && <p role="alert">{error}</p>}
      <fieldset className={styles.fields} disabled={busy}>
        <label className={ps.label} htmlFor="lab-title">Lab name</label>
        <input id="lab-title" className={ps.input} required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} />
        <label className={ps.label} htmlFor="lab-instructions">Instructions (optional)</label>
        <textarea id="lab-instructions" className={ps.textarea} maxLength={20000} value={instructions} onChange={e => setInstructions(e.target.value)} />
        <label className={ps.label} htmlFor="lab-chapter">Choose textbook files by chapter</label>
        <select id="lab-chapter" className={ps.select} value={chapter} onChange={e => setChapter(e.target.value)}>
          {textbookChapters.map(number => <option key={number} value={number}>Chapter {number}</option>)}
        </select>
        <div className={styles.catalog}>
          {textbookSources.filter(source => source.chapter === Number(chapter)).map(source => (
            <label key={source.name}>
              <input type="checkbox" checked={files.includes(source.name)} onChange={e => {
                setFiles(previous => e.target.checked ? [...previous, source.name] : previous.filter(name => name !== source.name));
              }} /> {source.name}
            </label>
          ))}
        </div>
        <h3 className={ps.h3}>Selected files — opening order</h3>
        {!files.length && <p>Select at least one file. Files can come from multiple chapters.</p>}
        <ol className={styles.selected}>
          {files.map((name, index) => <li key={name}>
            <span>{name} → {name.replace(/\.c$/, '.a')}</span>
            <div className={styles.actions}>
              <button type="button" className={ps.btn} disabled={index === 0} aria-label={`Move ${name} up`} onClick={() => move(index, -1)}>↑</button>
              <button type="button" className={ps.btn} disabled={index === files.length - 1} aria-label={`Move ${name} down`} onClick={() => move(index, 1)}>↓</button>
              <button type="button" className={ps.btn} aria-label={`Remove ${name}`} onClick={() => setFiles(previous => previous.filter(file => file !== name))}>Remove</button>
            </div>
          </li>)}
        </ol>
        <label className={styles.publish}><input type="checkbox" checked={isPublished} onChange={e => setPublished(e.target.checked)} /> Published — available to students</label>
        <p className={ps.muted}>Uncheck to save as a draft. Changes apply when students next import the lab.</p>
        <div className={styles.actions}>
          <button type="button" className={ps.btn} onClick={onCancel}>Cancel</button>
          <button type="submit" className={ps.btnPrimary} disabled={!title.trim() || !files.length}>{busy ? 'Saving…' : 'Save lab'}</button>
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
    <Page title="Lab Configuration" subtitle="Choose textbook sources, set their opening order, and publish labs for students." wide>
      {error && <p role="alert">{error}</p>}
      {labs === null && !error && <p>Loading labs…</p>}
      {labs && <>
        <button className={ps.btnPrimary} onClick={() => setEditing({})} disabled={editing !== null}>New lab</button>
        {editing !== null && <LabForm key={editing.id || 'new'} lab={editing.id ? editing : null} onSaved={saved} onCancel={() => setEditing(null)} />}
        {!labs.length && <p>No labs yet. Create a lab and select its textbook files.</p>}
        {labs.map(lab => <div key={lab.id} className={`${ps.card} ${ps.cardRow}`}>
          <div><strong>{lab.title}</strong> <span className={ps.badge}>{lab.isPublished ? 'Published' : 'Draft'}</span>
            <p className={ps.muted}>{lab.files.length} files: {lab.files.join(', ')}</p>
          </div>
          <button className={ps.btn} disabled={editing !== null} onClick={() => setEditing(lab)}>Edit</button>
        </div>)}
      </>}
    </Page>
  );
}
