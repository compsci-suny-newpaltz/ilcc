import { useEffect, useState } from 'react';
import styles from './ImportFiles.module.css';
import { textbookSources, textbookChapters } from '../../data/textbookSources';
import { api } from '../../lib/api';
import { loginUrl } from '../../hooks/useMe';

export default function ImportFiles({ tabSize, onImportFiles, onClose }) {
  const [mode, setMode] = useState('assembly');
  const [indent, setIndent] = useState('32');
  const [files, setFiles] = useState([]);
  const [chapter, setChapter] = useState(String(textbookChapters[0]));
  const [selectedSources, setSelectedSources] = useState([]);
  const [labs, setLabs] = useState(null);
  const [labId, setLabId] = useState('');
  const [labsError, setLabsError] = useState(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const validIndent = indent !== '' && Number.isInteger(Number(indent)) && Number(indent) >= 0 && Number(indent) <= 128;
  const isSource = mode !== 'assembly';
  const selectedLab = labs?.find(lab => String(lab.id) === labId);
  const hasFiles = mode === 'lab' ? Boolean(selectedLab) : mode === 'textbook' ? selectedSources.length > 0 : files.length > 0;

  useEffect(() => {
    if (mode !== 'lab') return;
    let active = true;
    api('/labs').then(rows => {
      if (!active) return;
      setLabs(rows);
      setLabsError(null);
    }).catch(err => { if (active) setLabsError(err); });
    return () => { active = false; };
  }, [mode, retry]);

  const importFiles = async e => {
    e.preventDefault();
    if (!hasFiles || busy || (isSource && !validIndent)) return;
    setBusy(true);
    setError('');
    try {
      let imports = mode === 'textbook'
        ? textbookSources.filter(source => selectedSources.includes(source.name))
          .map(source => ({ name: source.name, text: async () => source.content }))
        : files;
      if (mode === 'lab') {
        // Recheck publication and use the latest configuration at import time.
        const lab = await api(`/labs/${labId}`);
        imports = lab.files.map(name => {
          const source = textbookSources.find(item => item.name === name);
          if (!source) throw new Error(`The source ${name} is unavailable. Please reload the site and try again.`);
          return { name, text: async () => source.content };
        });
      }
      await onImportFiles(imports, isSource ? { indent: Number(indent), tabSize } : null);
      onClose();
    } catch (err) {
      setError(err.message || 'Could not read the selected files. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.panel} onSubmit={importFiles} aria-label="Import files">
      <label>
        Import
        <select disabled={busy} value={mode} onChange={e => {
          setMode(e.target.value); setFiles([]); setSelectedSources([]); setError('');
          setLabId(''); setLabs(null); setLabsError(null);
        }}>
          <option value="assembly">Assembly files (.a)</option>
          <option value="source">Source files as comments</option>
          <option value="textbook">Textbook C files as comments</option>
          <option value="lab">Lab</option>
        </select>
      </label>
      {isSource && <>
        <p>{mode === 'lab' ? 'Choose a published lab' : mode === 'textbook' ? 'Choose textbook C files' : 'Choose C or other text files'} to create commented .a files for translation.</p>
        <label>
          Indentation (columns)
          <input type="number" min="0" max="128" step="1" required value={indent}
            disabled={busy} onChange={e => setIndent(e.target.value)} />
        </label>
        <p>Default: 32 columns. Tab size: {tabSize} spaces.</p>
      </>}
      {mode === 'lab' ? <>
        {labsError && <div role="alert">
          {labsError.status === 401 ? <a href={loginUrl()}>Sign in to view labs</a> : <p>{labsError.message}</p>}
          <button type="button" onClick={() => { setLabsError(null); setRetry(value => value + 1); }}>Retry</button>
        </div>}
        {!labs && !labsError && <p>Loading labs…</p>}
        {labs?.length === 0 && <p>No published labs are available yet.</p>}
        {labs?.length > 0 && <label>
          Lab
          <select value={labId} disabled={busy} onChange={e => { setLabId(e.target.value); setError(''); }}>
            <option value="">Select a lab…</option>
            {labs.map(lab => <option key={lab.id} value={lab.id}>{lab.title}</option>)}
          </select>
        </label>}
        {selectedLab && <>
          {selectedLab.instructions && <p className={styles.instructions}>{selectedLab.instructions}</p>}
          <ol>{selectedLab.files.map(name => <li key={name}>{name} → {name.replace(/\.c$/, '.a')}</li>)}</ol>
          <p>Files open in new tabs. Your existing work is preserved.</p>
        </>}
      </> : mode === 'textbook' ? <>
        <label>
          Chapter
          <select disabled={busy} value={chapter} onChange={e => { setChapter(e.target.value); setSelectedSources([]); }}>
            {textbookChapters.map(number => <option key={number} value={number}>Chapter {number}</option>)}
          </select>
        </label>
        <fieldset className={styles.sourceList} disabled={busy}>
          <legend>Textbook files</legend>
          {textbookSources.filter(source => source.chapter === Number(chapter)).map(source => (
            <label key={source.name}>
              <input type="checkbox" checked={selectedSources.includes(source.name)} onChange={e => {
                setSelectedSources(previous => e.target.checked
                  ? [...previous, source.name] : previous.filter(name => name !== source.name));
              }} />
              {source.name}
            </label>
          ))}
        </fieldset>
      </> : <label>
        Files
        <input key={mode} type="file" multiple accept={mode === 'assembly' ? '.a' : undefined}
          disabled={busy} onChange={e => { setFiles(Array.from(e.target.files)); setError(''); }} />
      </label>}
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={busy || !hasFiles || (isSource && !validIndent)}>
          {busy ? 'Importing…' : mode === 'lab' ? 'Open lab files' : 'Open in editor'}
        </button>
      </div>
    </form>
  );
}
