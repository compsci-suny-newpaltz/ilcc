/* Register-form `cmp rA, rB` must set the flags exactly like `sub` would
   (found by the cuh63 corpus: otest.a stopped at 28 because `cmp r5, r5`
   followed by `bre` did not branch; real lcc prints 1..33). */
import { describe, it, expect } from 'vitest';
import { createRunSession } from '../src/services/runner.js';

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

describe('cmp register form sets flags', () => {
  it('cmp r5, r5 then bre branches (Z set)', async () => {
    expect(await run('    mvi r5, 28\n    cmp r5, r5\n    bre ok\n    mvi r0, 0\n    dout r0\n    halt\nok: mvi r0, 1\n    dout r0\n    halt\n')).toBe('1');
  });
  it('cmp r1, r2 with r1 < r2 then brlt branches (N set)', async () => {
    expect(await run('    mvi r1, 3\n    mvi r2, 5\n    cmp r1, r2\n    brlt ok\n    mvi r0, 0\n    dout r0\n    halt\nok: mvi r0, 1\n    dout r0\n    halt\n')).toBe('1');
  });
  it('cmp r1, r2 with r1 > r2 then brgt branches', async () => {
    expect(await run('    mvi r1, 7\n    mvi r2, 5\n    cmp r1, r2\n    brgt ok\n    mvi r0, 0\n    dout r0\n    halt\nok: mvi r0, 1\n    dout r0\n    halt\n')).toBe('1');
  });
});
