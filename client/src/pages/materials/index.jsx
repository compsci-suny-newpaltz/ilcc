/* Materials — slides & textbook viewer. */
import { useEffect, useMemo, useState, useCallback } from 'react';
import { ExternalLink, Download, FileText, BookOpen, ChevronLeft, ChevronRight, ChevronDown } from 'lucide-react';
import Page from '../../components/Page';
import ps from '../../components/Page.module.css';
import { api, fmtBytes } from '../../lib/api';
import s from './Materials.module.css';

const BASE = import.meta.env.BASE_URL;
const LS_KEY = 'ilcc.materials.last';
const TEXTBOOK_ID = '__textbook__';

export default function Materials() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [page, setPage] = useState('');          // what the user typed: the PRINTED page number
  const [pdfPage, setPdfPage] = useState(0);      // what the iframe gets (#page=)
  const [toc, setToc] = useState(null);
  const [openCh, setOpenCh] = useState(null);

  useEffect(() => {
    api('/materials').then((d) => { setData(d); if (d.textbook) api('/materials/textbook/toc').then(setToc).catch(() => setToc(null)); }).catch((e) => setErr(e.message));
  }, []);

  /* Printed page → PDF page. The scan is missing a few leaves, so the offset
     changes; toc.pageLabels.segments = [[pdfStart, printedStart], …]. */
  const toPdfPage = useCallback((printed) => {
    if (!(printed > 0)) return 0;
    const segs = toc?.pageLabels?.segments;
    if (!segs) return printed;
    let best = null;
    for (const [pdfStart, printedStart] of segs) if (printed >= printedStart && (!best || printedStart > best[1])) best = [pdfStart, printedStart];
    return best ? printed - best[1] + best[0] : printed;
  }, [toc]);

  const gotoPrinted = (v) => { setPage(v); setPdfPage(toPdfPage(parseInt(v, 10))); };
  const gotoPdf = (pp, printed) => { setSelectedId(TEXTBOOK_ID); setPdfPage(pp); setPage(printed != null ? String(printed) : ''); };

  // Flat, ordered list of selectable entries.
  const entries = useMemo(() => {
    if (!data) return [];
    const out = [];
    if (data.textbook) {
      out.push({ id: TEXTBOOK_ID, title: data.textbook.title || 'Textbook', ext: 'pdf', url: data.textbook.url, downloadUrl: data.textbook.downloadUrl, textbook: true, chapter: null });
    }
    for (const ch of data.chapters || []) {
      for (const it of ch.items || []) {
        out.push({ ...it, url: `${BASE}api/materials/${it.id}`, chapterTitle: ch.title });
      }
    }
    return out;
  }, [data]);

  // Initial selection: saved > textbook > first PDF.
  useEffect(() => {
    if (!entries.length || selectedId) return;
    let saved = null;
    try { saved = localStorage.getItem(LS_KEY); } catch { /* ignore */ }
    const pick = entries.find((e) => e.id === saved)
      || entries.find((e) => e.textbook)
      || entries.find((e) => e.ext === 'pdf')
      || entries[0];
    setSelectedId(pick.id);
  }, [entries, selectedId]);

  const select = useCallback((id) => {
    setSelectedId(id); setPage(''); setPdfPage(0);
    try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
  }, []);

  const idx = entries.findIndex((e) => e.id === selectedId);
  const current = idx >= 0 ? entries[idx] : null;

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft' && idx > 0) select(entries[idx - 1].id);
      if (e.key === 'ArrowRight' && idx < entries.length - 1) select(entries[idx + 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, entries, select]);

  const siblingPdf = useMemo(() => {
    if (!current || current.ext === 'pdf') return null;
    return entries.find((e) => e.ext === 'pdf' && !e.textbook && e.chapter === current.chapter && e.id !== current.id) || null;
  }, [current, entries]);

  const frameSrc = current ? (current.textbook && pdfPage > 0 ? `${current.url}#page=${pdfPage}` : current.url) : '';
  const dlHref = current ? (current.downloadUrl || current.url) : '';

  const body = () => {
    if (err) return <div className={ps.card}><p className={ps.p}>Couldn't load materials: {err}</p></div>;
    if (!data) return <div className={ps.empty}><span className={ps.spinner} /></div>;
    if (!entries.length) return <div className={ps.empty}>No materials have been posted yet.</div>;
    return (
      <div className={s.layout}>
        <nav className={s.rail} aria-label="Materials">
          {data.textbook && (
            <div className={s.railGroup}>
              <p className={s.railTitle}>Textbook</p>
              <button className={`${s.railItem} ${selectedId === TEXTBOOK_ID ? s.railActive : ''}`} onClick={() => select(TEXTBOOK_ID)}>
                <BookOpen size={14} /><span className={s.railText}>{data.textbook.title || 'Textbook'}</span>
              </button>
              {toc && selectedId === TEXTBOOK_ID && (
                <ol className={s.toc} aria-label="Table of contents">
                  {toc.chapters.map((ch, i) => {
                    const ext = ch.external ? entries.find((e) => (e.name || '').toLowerCase() === ch.external.toLowerCase()) : null;
                    const open = openCh === i;
                    return (
                      <li key={i}>
                        <div className={s.tocRow}>
                          <button type="button" className={`${s.tocChapter} ${pdfPage && ch.pdfPage === pdfPage ? s.railActive : ''}`}
                            onClick={() => (ext ? select(ext.id) : ch.pdfPage && gotoPdf(ch.pdfPage, ch.page))} title={ch.external ? `Opens ${ch.external}` : `Page ${ch.page}`}>
                            {ch.chapter ? <span className={s.tocNum}>{ch.chapter}</span> : null}<span className={s.railText}>{ch.title}</span>
                            {ch.page != null && <span className={s.tocPage}>{ch.page}</span>}
                          </button>
                          {ch.sections?.length > 0 && (
                            <button type="button" className={s.tocToggle} aria-expanded={open} aria-label={open ? 'Collapse' : 'Expand'} onClick={() => setOpenCh(open ? null : i)}>
                              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                            </button>
                          )}
                        </div>
                        {open && (
                          <ol className={s.tocSections}>
                            {ch.sections.map((sec, k) => (
                              <li key={k}>
                                <button type="button" className={`${s.tocSection} ${pdfPage && sec.pdfPage === pdfPage ? s.railActive : ''}`} disabled={!sec.pdfPage}
                                  onClick={() => sec.pdfPage && gotoPdf(sec.pdfPage, sec.page)}>
                                  <span className={s.railText}>{sec.title}</span><span className={s.tocPage}>{sec.page}</span>
                                </button>
                              </li>
                            ))}
                          </ol>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}
          {(data.chapters || []).map((ch, i) => (
            <div className={s.railGroup} key={i}>
              <p className={s.railTitle}>{ch.chapter != null ? `Ch. ${ch.chapter} — ` : ''}{ch.title}</p>
              {ch.items.map((it) => (
                <button key={it.id} className={`${s.railItem} ${selectedId === it.id ? s.railActive : ''}`} onClick={() => select(it.id)} title={it.name}>
                  <FileText size={14} /><span className={s.railText}>{it.title || it.name}</span><span className={s.ext}>{it.ext}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div>
          <select className={`${ps.select} ${s.mobileSelect}`} value={selectedId || ''} onChange={(e) => select(e.target.value)} aria-label="Select material">
            {entries.map((e) => (
              <option key={e.id} value={e.id}>{e.textbook ? 'Textbook — ' : e.chapterTitle ? `${e.chapterTitle} — ` : ''}{e.title || e.name} ({e.ext})</option>
            ))}
          </select>

          {current && (
            <>
              <div className={s.toolbar}>
                <button className={ps.btn} onClick={() => idx > 0 && select(entries[idx - 1].id)} disabled={idx <= 0} title="Previous (←)"><ChevronLeft size={14} /></button>
                <button className={ps.btn} onClick={() => idx < entries.length - 1 && select(entries[idx + 1].id)} disabled={idx >= entries.length - 1} title="Next (→)"><ChevronRight size={14} /></button>
                <h2 className={s.toolbarTitle}>{current.title || current.name}{current.size ? <span className={`${ps.muted} ${ps.small}`}> · {fmtBytes(current.size)}</span> : null}</h2>
                {current.textbook && (
                  <label className={s.pageJump} title="Printed page number, as in the table of contents">Book page
                    <input className={ps.input} type="number" min="1" value={page} onChange={(e) => gotoPrinted(e.target.value)} placeholder="#" />
                  </label>
                )}
                <a className={ps.btn} href={frameSrc} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Open in new tab</a>
                <a className={ps.btn} href={dlHref} download><Download size={14} /> Download</a>
              </div>
              {current.ext === 'pdf' ? (
                <iframe className={s.frame} src={frameSrc} title={current.title || current.name} />
              ) : (
                <div className={ps.card}>
                  <h3 className={ps.h3} style={{ marginTop: 0 }}>{current.title || current.name}</h3>
                  <p className={ps.p}>Browsers can't render .{current.ext} — download it{siblingPdf ? ', or open the PDF version' : ''}.</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a className={ps.btnPrimary} href={current.url} download><Download size={14} /> Download .{current.ext}{current.size ? ` (${fmtBytes(current.size)})` : ''}</a>
                    {siblingPdf && <button className={ps.btn} onClick={() => select(siblingPdf.id)}><FileText size={14} /> Open PDF version</button>}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return <Page title="Materials" subtitle="Lecture slides and the course textbook. Use ← / → to move between items." wide>{body()}</Page>;
}
