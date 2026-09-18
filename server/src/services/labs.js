const db = require('../db');
const catalog = new Set(require('../textbookSources.json'));

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const decode = row => row ? {
  id: row.id, title: row.title, instructions: row.instructions,
  files: JSON.parse(row.files_json), isPublished: Boolean(row.is_published),
  createdBy: row.created_by_email, updatedAt: row.updated_at,
} : null;

function validate(body) {
  const { title, instructions = '', files, isPublished = false } = body || {};
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) fail('Lab name must contain 1–200 characters.');
  if (typeof instructions !== 'string' || instructions.length > 20000) fail('Instructions must be text of at most 20,000 characters.');
  if (typeof isPublished !== 'boolean') fail('Published status must be a boolean.');
  if (!Array.isArray(files) || files.length < 1 || files.length > catalog.size
    || files.some(name => !catalog.has(name)) || new Set(files).size !== files.length) {
    fail('Select one or more distinct files from the textbook catalog.');
  }
  return { title: title.trim(), instructions, files, isPublished };
}

function list(admin = false) {
  return db.prepare(`SELECT * FROM labs ${admin ? '' : 'WHERE is_published = 1'} ORDER BY id`).all().map(decode);
}

function get(id, admin = false) {
  if (!/^\d+$/.test(String(id))) fail('Lab not found.', 404);
  const row = db.prepare(`SELECT * FROM labs WHERE id = ? ${admin ? '' : 'AND is_published = 1'}`).get(id);
  if (!row) fail('Lab not found.', 404);
  return decode(row);
}

function create(body, email) {
  const lab = validate(body);
  const result = db.prepare('INSERT INTO labs (title, instructions, files_json, is_published, created_by_email) VALUES (?, ?, ?, ?, ?)')
    .run(lab.title, lab.instructions, JSON.stringify(lab.files), Number(lab.isPublished), email);
  return get(result.lastInsertRowid, true);
}

function update(id, body) {
  get(id, true);
  const lab = validate(body);
  db.prepare("UPDATE labs SET title = ?, instructions = ?, files_json = ?, is_published = ?, updated_at = datetime('now') WHERE id = ?")
    .run(lab.title, lab.instructions, JSON.stringify(lab.files), Number(lab.isPublished), id);
  return get(id, true);
}

module.exports = { list, get, create, update };
