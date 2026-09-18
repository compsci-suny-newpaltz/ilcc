import { useState } from 'react';
import styles from './ImportFiles.module.css';

export default function ImportFiles({ tabSize, onImportFiles, onClose }) {
  const [mode, setMode] = useState('assembly');
  const [indent, setIndent] = useState('32');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const validIndent = indent !== '' && Number.isInteger(Number(indent)) && Number(indent) >= 0 && Number(indent) <= 128;

  const importFiles = async e => {
    e.preventDefault();
    if (!files.length || busy || (mode === 'source' && !validIndent)) return;
    setBusy(true);
    setError('');
    try {
      await onImportFiles(files, mode === 'source' ? { indent: Number(indent), tabSize } : null);
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
        <select disabled={busy} value={mode} onChange={e => { setMode(e.target.value); setFiles([]); setError(''); }}>
          <option value="assembly">Assembly files (.a)</option>
          <option value="source">Source files as comments</option>
        </select>
      </label>
      {mode === 'source' && <>
        <p>Choose C or other text files to create commented .a files for translation.</p>
        <label>
          Indentation (columns)
          <input type="number" min="0" max="128" step="1" required value={indent}
            disabled={busy} onChange={e => setIndent(e.target.value)} />
        </label>
        <p>Default: 32 columns. Tab size: {tabSize} spaces.</p>
      </>}
      <label>
        Files
        <input key={mode} type="file" multiple accept={mode === 'assembly' ? '.a' : undefined}
          disabled={busy} onChange={e => { setFiles(Array.from(e.target.files)); setError(''); }} />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={busy || !files.length || (mode === 'source' && !validIndent)}>
          {busy ? 'Importing…' : 'Open in editor'}
        </button>
      </div>
    </form>
  );
}
