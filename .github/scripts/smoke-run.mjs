// smoke-run.mjs — exercise the SHIPPED assembler + interpreter inside the built
// image through its own /api/run WebSocket, exactly as the browser does, with
// every runnable program from the cuh63 textbook package (server/test/fixtures/
// cuh63, golden output captured from the real lcc 6.3 by
// server/scripts/gen-cuh63-golden.py).
// Usage (Node 22+, or Node 20 with --experimental-websocket):
//   node .github/scripts/smoke-run.mjs http://localhost:3000
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const base = (process.argv[2] || 'http://localhost:3000').replace(/^http/, 'ws');
const dir  = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', 'test', 'fixtures', 'cuh63');

function run(code, inputs = [], timeoutMs = 10000) {
  const queue = [...inputs];
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/api/run`);
    let out = '';
    const t = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'start', code }));
    ws.onerror = (e) => { clearTimeout(t); reject(new Error(`ws error: ${e.message || e}`)); };
    ws.onmessage = (m) => {
      const j = JSON.parse(m.data);
      if (j.type === 'output') out += j.text;
      else if (j.type === 'input_request') ws.send(JSON.stringify({ type: 'input', text: queue.shift() ?? '' }));
      else if (j.type === 'done') { clearTimeout(t); ws.close(); resolve({ out }); }
      else if (j.type === 'error') { clearTimeout(t); ws.close(); resolve({ error: j.message }); }
    };
  });
}
const norm = (s) => s.replace(/\s+$/, '');
/* /api/run echoes consumed input like a terminal (the browser path); lcc with
   piped stdin does not. Drop each echoed line, in order, before comparing. */
function stripEcho(out, inputs) {
  let from = 0;
  for (const line of inputs) {
    const i = out.indexOf(line + '\n', from);
    if (i < 0) break;
    out = out.slice(0, i) + out.slice(i + line.length + 1); from = i;
  }
  return out;
}

const programs = readdirSync(dir).filter(f => f.endsWith('.a')).sort().map(f => {
  const name = f.slice(0, -2), p = (ext) => path.join(dir, name + ext);
  return {
    name, code: readFileSync(p('.a'), 'utf8'),
    expected: existsSync(p('.expected')) ? readFileSync(p('.expected'), 'utf8') : null,
    mustFail: existsSync(p('.error')),
    inputs:   existsSync(p('.stdin')) ? readFileSync(p('.stdin'), 'utf8').replace(/\n$/, '').split('\n') : [],
  };
});
if (programs.length < 40) { console.log(`FAIL only ${programs.length} corpus programs found in ${dir}`); process.exit(1); }

let failed = 0, ok = 0;
for (const p of programs) {
  try {
    const r = await run(p.code, p.inputs);
    if (p.mustFail) {
      if (r.error) ok++; else { failed++; console.log(`FAIL ${p.name}: lcc rejects this program but the site ran it`); }
    } else if (r.error) { failed++; console.log(`FAIL ${p.name}: ${r.error}`); }
    else if (norm(stripEcho(r.out, p.inputs)) === norm(p.expected)) ok++;
    else { failed++; console.log(`FAIL ${p.name}\n  expected: ${JSON.stringify(p.expected)}\n  got:      ${JSON.stringify(r.out)}`); }
  } catch (e) { failed++; console.log(`FAIL ${p.name}: ${e.message}`); }
}
console.log(`${ok} ok, ${failed} failed (${programs.length} cuh63 programs via /api/run)`);
process.exit(failed ? 1 : 0);
