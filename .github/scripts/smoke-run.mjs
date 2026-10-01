// smoke-run.mjs — exercise the SHIPPED assembler + interpreter inside the built
// image through its own /api/run WebSocket, exactly as the browser does.
// Usage (Node 22+, or Node 20 with --experimental-websocket):
//   node .github/scripts/smoke-run.mjs http://localhost:3000
import { readFileSync } from 'node:fs';

const base = (process.argv[2] || 'http://localhost:3000').replace(/^http/, 'ws');

function run(code, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/api/run`);
    let out = '';
    const t = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, timeoutMs);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'start', code }));
    ws.onerror = (e) => { clearTimeout(t); reject(new Error(`ws error: ${e.message || e}`)); };
    ws.onmessage = (m) => {
      const j = JSON.parse(m.data);
      if (j.type === 'output') out += j.text;
      else if (j.type === 'input_request') ws.send(JSON.stringify({ type: 'input', text: '' }));
      else if (j.type === 'done') { clearTimeout(t); ws.close(); resolve(out); }
      else if (j.type === 'error') { clearTimeout(t); ws.close(); reject(new Error(j.message)); }
    };
  });
}

const cases = [
  { name: 'hello', code: '    mov r0, 5\n    dout r0\n    nl\n    halt\n', expect: '5\n' },
  { name: 'c0413 (ldr/str past 0xffff reads slack like real lcc)',
    code: readFileSync(new URL('../../server/test/fixtures/programs/c0413_uninit_args.a', import.meta.url), 'utf8'),
    expect: 'f: 0 0\ng: 1 2\nh: 2 3\nk: 5 -1\nh: 3 4\nk: 7 -1\n' },
];

let failed = 0;
for (const c of cases) {
  try {
    const got = await run(c.code);
    if (got === c.expect) console.log(`ok   ${c.name}`);
    else { failed++; console.log(`FAIL ${c.name}\n  expected: ${JSON.stringify(c.expect)}\n  got:      ${JSON.stringify(got)}`); }
  } catch (e) { failed++; console.log(`FAIL ${c.name}: ${e.message}`); }
}
process.exit(failed ? 1 : 0);
