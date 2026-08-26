/*
 * submissions-zip.js — turn a Brightspace bulk-download zip into students + files.
 *
 * Built against a real export ("Lab 4 Download …zip", 30 students, 122 files):
 *   "<orgDefinedId>-<courseId> - First Last - Mar 2, 2026 954 PM/<file>"
 *   • students upload several files of mixed types (.a .txt .pdf .docx .c …)
 *   • a resubmit creates a SECOND timestamped folder for the same student —
 *     merge by orgDefinedId, newest copy of each basename wins
 *   • index.html at the root lists canonical "Last, First" names + submit times
 *   • each .a is usually a different question, named however the student liked
 *     (ch3p5 / lab4Q5 / q5 / 3-5 / lab4ex0305 / labfourfifthq / problem1 …)
 *
 * parseSubmissionsZip(buffer) →
 *   { students: [{ orgDefinedId, displayName, lastFirst, folders[], files: [{ name, ext, mime, size, isText, content|blob, submittedAt, questionNumber }] }],
 *     index: { hasIndex, names: n } }
 */
const AdmZip = require('adm-zip');
const config = require('../config');

const MAC_JUNK = /(^|\/)(__MACOSX\/|\._)/;
const TEXT_EXT = new Set(['a', 'txt', 'lst', 'bst', 'c', 'cpp', 'h', 'cn', 'cpn', 'an', 'md', 'csv', 'json', 'e', 'hex', 'm', 'sm', 'log']);
const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', zip: 'application/zip' };

/* ---------- pure helpers (exported for tests) ---------- */

function isMacJunkBytes(buf) {
  return buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x05 && buf[2] === 0x16 && buf[3] === 0x07;
}
function cleanText(buf) {
  return buf.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}
function extOf(name) {
  const m = name.match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '';
}
/* "123456-4648013 - Jane Doe - Mar 2, 2026 954 PM" */
function parseFolder(folder) {
  const m = folder.match(/^\s*(\d+)(?:-\d+)?\s*-\s*(.+?)\s*-\s*([A-Z][a-z]{2} \d{1,2}, \d{4} \d{3,4} [AP]M)\s*$/);
  if (!m) return { orgDefinedId: folder.match(/^\s*(\d{3,})/)?.[1] ?? null, displayName: folder.replace(/^\d[\d-]*\s*-\s*/, '').trim() || folder, when: null };
  return { orgDefinedId: m[1], displayName: m[2], when: parseBrightspaceDate(m[3]) };
}
/* "Mar 2, 2026 954 PM" → ISO (Brightspace omits the colon in the time) */
function parseBrightspaceDate(s) {
  const m = String(s).match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) (\d{1,2})(\d{2}) ([AP]M)$/);
  if (!m) return null;
  const [, mon, d, y, hh, mm, ap] = m;
  let h = Number(hh) % 12; if (ap === 'PM') h += 12;
  const t = Date.parse(`${mon} ${d}, ${y} ${String(h).padStart(2, '0')}:${mm}:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

const WORD_NUMS = [['seventeen', 17], ['thirteen', 13], ['fourteen', 14], ['fifteen', 15], ['sixteen', 16], ['eighteen', 18], ['nineteen', 19],
  ['twelfth', 12], ['twelvth', 12], ['twelve', 12], ['eleven', 11], ['twenty', 20], ['ten', 10], ['nine', 9], ['eight', 8], ['seven', 7], ['six', 6],
  ['fifth', 5], ['five', 5], ['four', 4], ['three', 3], ['two', 2], ['one', 1]];

/* Best-effort question number from a filename. Returns null if unsure. */
function questionNumber(name) {
  let b = name.replace(/\.[A-Za-z0-9]+$/, '').toLowerCase().trim();
  // drop a leading lab/chapter/assignment prefix incl. "lab 4", "lab4_", "ch3pt2", "lab four"
  b = b.replace(/^(lab|ch(?:apter)?|assignment|hw|homework)\s*[_\-.#]?\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:pt|part)?\s*\d*\s*[_\-. ]*/, '');
  let m = b.match(/ex\s*0?(\d)\s*0?(\d{1,2})\b/); if (m) return Number(m[2]);          // ex0305 → 5
  m = b.match(/(?:q|question|p|prob|problem|part|exercise|ex|e|#)\s*[_\-. ]?\s*0*(\d{1,2})\b/); if (m) return Number(m[1]);
  m = b.match(/(?:^|[^\d])0*(\d{1,2})$/); if (m) return Number(m[1]);                 // "3-5", "lab4.12"
  for (const [w, n] of WORD_NUMS) if (b.includes(w)) return n;                          // labfourfifthq
  return null;
}

/* Parse Brightspace's index.html: { "Last, First": [{ file, submittedAt }] } */
function parseIndexHtml(htmlText) {
  const out = {};
  if (!htmlText) return out;
  const sections = htmlText.split(/<tr bgcolor=#AAAAAA>/i).slice(1);
  for (const sec of sections) {
    const name = sec.match(/<b>([^<]+)<\/b>/)?.[1]?.trim();
    if (!name) continue;
    const files = [];
    const re = /valign=top>([^<]+?)<p[^>]*>.*?<b>Submitted:<\/b><br>([^<]+)<\/td>/gs;
    let m; while ((m = re.exec(sec))) files.push({ file: m[1].trim(), submittedAt: parseBrightspaceDate(m[2].trim()) });
    out[name] = files;
  }
  return out;
}

/* "Jane Doe" → "Doe, Jane" (for index.html lookup) */
function lastFirst(displayName) {
  const parts = displayName.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}` : displayName;
}

/* ---------- main ---------- */

function parseSubmissionsZip(buffer) {
  const maxBytes = config.maxZipMb * 1024 * 1024;
  if (buffer.length > maxBytes) throw Object.assign(new Error(`zip exceeds ${config.maxZipMb} MB`), { status: 413 });

  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const indexEntry = entries.find(e => /(^|\/)index\.html?$/i.test(e.entryName) && e.entryName.split('/').length <= 2);
  const index = indexEntry ? parseIndexHtml(indexEntry.getData().toString('utf8')) : {};

  const byId = new Map();   // orgDefinedId (or folder) → student
  for (const e of entries) {
    if (e.isDirectory) continue;
    const name = e.entryName;
    if (MAC_JUNK.test(name) || /(^|\/)index\.html?$/i.test(name)) continue;
    const segs = name.split('/').filter(Boolean);
    if (segs.length < 2) continue;                       // files at root aren't submissions
    const file = segs[segs.length - 1];
    if (file.startsWith('.')) continue;
    const folder = segs[0];
    const { orgDefinedId, displayName, when } = parseFolder(folder);
    const key = orgDefinedId || folder;

    const data = e.getData();
    if (isMacJunkBytes(data)) continue;
    if (data.length > 25 * 1024 * 1024) continue;

    if (!byId.has(key)) {
      byId.set(key, { orgDefinedId, displayName, lastFirst: lastFirst(displayName), folders: [], _files: new Map() });
    }
    const st = byId.get(key);
    if (!st.folders.includes(folder)) st.folders.push(folder);

    const ext = extOf(file);
    const isText = TEXT_EXT.has(ext) || (!MIME[ext] && looksLikeText(data));
    const rec = {
      name: file, ext, mime: isText ? 'text/plain' : (MIME[ext] || 'application/octet-stream'),
      size: data.length, isText,
      content: isText ? cleanText(data) : null,
      blob: isText ? null : data,
      submittedAt: when,
      questionNumber: ext === 'a' ? questionNumber(file) : null,
      _folderWhen: when || '',
    };
    /* Same basename from two folders (resubmit) → keep the newer folder's copy. */
    const k = file.toLowerCase();
    const cur = st._files.get(k);
    if (!cur || rec._folderWhen >= cur._folderWhen) st._files.set(k, rec);
  }

  const students = [...byId.values()].map(st => {
    const files = [...st._files.values()].map(({ _folderWhen, ...f }) => f);
    /* Prefer index.html submit times when they match a filename stem. */
    const idx = index[st.lastFirst];
    if (idx) for (const f of files) {
      const stem = f.name.replace(/\.[^.]+$/, '');
      const hit = idx.find(x => x.file === stem || x.file === f.name);
      if (hit?.submittedAt) f.submittedAt = hit.submittedAt;
    }
    /* Positional fallback: if several .a files have NO number, number them in name order. */
    const asm = files.filter(f => f.ext === 'a').sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (asm.length && asm.every(f => f.questionNumber == null)) asm.forEach((f, i) => { f.questionNumber = i + 1; f.questionGuessed = true; });
    files.sort((a, b) => (a.ext === 'a' ? 0 : 1) - (b.ext === 'a' ? 0 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true }));
    return { orgDefinedId: st.orgDefinedId, displayName: st.displayName, lastFirst: st.lastFirst, folders: st.folders.sort(), files };
  }).sort((a, b) => a.lastFirst.localeCompare(b.lastFirst));

  return { students, index: { hasIndex: !!indexEntry, names: Object.keys(index).length } };
}

function looksLikeText(buf) {
  const n = Math.min(buf.length, 2048);
  if (!n) return true;
  let bad = 0;
  for (let i = 0; i < n; i++) { const c = buf[i]; if (c === 0 || (c < 7) || (c > 13 && c < 32)) bad++; }
  return bad / n < 0.02;
}

module.exports = {
  parseSubmissionsZip, questionNumber, parseFolder, parseBrightspaceDate, parseIndexHtml, lastFirst, isMacJunkBytes, cleanText, extOf,
};
