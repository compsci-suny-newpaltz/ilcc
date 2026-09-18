// Shared by uploaded sources and future bundled textbook sources.
export function commentSource(name, source, { indent = 32, tabSize = 4 } = {}) {
  if (!Number.isInteger(indent) || indent < 0 || indent > 128) {
    throw new Error('Indentation must be a whole number from 0 to 128.');
  }
  if (!Number.isInteger(tabSize) || tabSize < 2 || tabSize > 12) {
    throw new Error('Tab size must be a whole number from 2 to 12.');
  }
  const prefix = '\t'.repeat(Math.floor(indent / tabSize)) + ' '.repeat(indent % tabSize);
  const normalized = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const content = lines.map(line => {
    if (!line.trim()) return '';
    const [, whitespace, text] = line.match(/^([\t ]*)(.*)$/);
    return `${prefix}${whitespace}; ${text}`;
  }).join('\n') + '\n';
  const dot = name.lastIndexOf('.');
  return { name: (dot > 0 ? name.slice(0, dot) : name) + '.a', content };
}
