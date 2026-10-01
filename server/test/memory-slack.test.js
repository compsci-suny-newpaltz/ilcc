/*
 * LDR/STR effective addresses must NOT wrap at 16 bits.
 *
 * The real `lcc` (6.3) computes base + offset6 in a wide int and indexes an
 * oversized, zero-filled memory array, so a frame near the top of memory
 * (sp starts at 0 and the first push wraps it to 0xffff, fp = 0xfffe inside
 * main) can read and write up to 31 words PAST 0xffff and 32 words BELOW 0
 * without touching real program memory. Verified against lcc 6.3 with the
 * fixture programs below; the expected strings are its exact output.
 *
 * The web interpreter masked the address with & 0xffff, so `ldr r0, fp, 2`
 * read mem[0] (the first instruction word) and a store there clobbered the
 * program. Student report: c0413.a printed "f: 18548 58" instead of "f: 0 0".
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRunSession } from '../src/services/runner.js';

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', 'programs', name), 'utf8');

function run(source) {
  return new Promise((resolve, reject) => {
    let out = '';
    const s = createRunSession(source, {
      onOutput: (t) => { out += t; },
      onInputRequest: () => s.provideInput(''),
      onDone: () => resolve(out),
      onError: (m) => reject(new Error(m)),
    }, { echoInput: false });
    s.start();
  });
}

describe('LDR/STR linear addressing (matches real lcc)', () => {
  it('ldr past 0xffff reads zero-filled slack, not the program at mem[0]', async () => {
    // prints sp, fp, [fp+2], [fp+5], [fp+1] with fp = 0xfffe
    expect(await run(fixture('mem_slack_read.a'))).toBe('0\nfffe\n0\n0\n0\n');
  });

  it('str past 0xffff round-trips and leaves mem[0] untouched', async () => {
    // stores 0x1234 at fp+2 (= 0x10000), reads it back, then reads mem[0] (= `push lr`)
    expect(await run(fixture('mem_slack_store.a'))).toBe('1234\nae00\n');
  });

  it('negative addresses round-trip and base+offset aliases are linear', async () => {
    // [0-1] <- 0x1111 then read back; [0-32] reads 0; store via 0xfffe+3, read via 0xffff+2
    expect(await run(fixture('mem_slack_negative.a'))).toBe('1111\n0\n2222\n');
  });

  it('c0413 with uninitialised main args prints what real lcc prints', async () => {
    expect(await run(fixture('c0413_uninit_args.a')))
      .toBe('f: 0 0\ng: 1 2\nh: 2 3\nk: 5 -1\nh: 3 4\nk: 7 -1\n');
  });
});

/* The debugger flattens STR changes for the Memory/Stack panels. A store into
   slack (address 0x10000) must keep its real address — masking it to 0x0000
   would show the program's first word as modified. */
import WebSocket from 'ws';
describe('debugger memory diff keeps slack addresses linear', () => {
  it('str at fp+2 (0x10000) is reported at 0x10000, not 0x0000', async () => {
    const { server } = require('../index.js');
    if (!server.listening) await new Promise(r => server.listen(0, r));
    const port = server.address().port;
    const cells = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/api/debug`);
      const got = [];
      const t = setTimeout(() => { ws.terminate(); reject(new Error('ws timeout')); }, 5000);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'start', code: fixture('mem_slack_store.a') })));
      ws.on('message', (m) => {
        const j = JSON.parse(m);
        if (j.type === 'line_map') ws.send(JSON.stringify({ type: 'step', n: 5 })); // push, push, mov, ld, str
        if (j.type === 'step_result') { got.push(...(j.diff.memory || [])); clearTimeout(t); ws.close(); resolve(got); }
        if (j.type === 'error') { clearTimeout(t); ws.close(); reject(new Error(j.message)); }
      });
    });
    await new Promise(r => server.close(r));
    const addrs = cells.map(c => c.addr);
    expect(addrs).toContain(0x10000);
    expect(addrs).not.toContain(0);
  });
});
