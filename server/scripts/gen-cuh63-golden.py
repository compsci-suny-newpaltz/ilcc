#!/usr/bin/env python3
"""
gen-cuh63-golden.py — capture the REAL lcc's output for every textbook program.

  python3 scripts/gen-cuh63-golden.py <path/to/lcc> <cuh63 dir> [<out dir>]

For each <cuh63 dir>/*.a (the "C and C++ Under the Hood" sample programs):
  * linker modules (.extern/.global) are skipped — they only assemble to .o
  * the program is run with lcc 6.3 in a scratch dir, feeding "test" for the
    name prompt and then <out dir>/<name>.stdin if present
  * everything lcc printed after its "===== Output" banner, minus the single
    newline lcc appends at the end, becomes <out dir>/<name>.expected
  * a program lcc refuses to assemble gets <out dir>/<name>.error instead
    (the shipped assembler must reject it as well)
The .a file is copied next to it; test/cuh63-corpus.test.js replays them
through the shipped assembler + interpreter. Skips are listed in SKIPPED.txt.
Re-run this only when the package or lcc itself changes.
"""
import os, re, shutil, subprocess, sys, tempfile

lcc, src = sys.argv[1], sys.argv[2]
out = sys.argv[3] if len(sys.argv) > 3 else os.path.join(os.path.dirname(__file__), '..', 'test', 'fixtures', 'cuh63')
os.makedirs(out, exist_ok=True)
skipped, kept, errors = [], 0, 0
for fn in sorted(f for f in os.listdir(src) if f.endswith('.a')):
    name = fn[:-2]
    text = open(os.path.join(src, fn), errors='replace').read()
    if re.search(r'^\s*\.(extern|global)\b', text, re.M):
        skipped.append(f'{name}: linker module (.extern/.global) — only assembles to .o, cannot run standalone'); continue
    stdin = 'test\n'
    sp = os.path.join(out, name + '.stdin')
    if os.path.exists(sp):
        stdin += open(sp).read()
        if not stdin.endswith('\n'): stdin += '\n'
    tmp = tempfile.mkdtemp()
    shutil.copy(os.path.join(src, fn), tmp)
    try:
        p = subprocess.run([lcc, fn], cwd=tmp, input=stdin.encode(), capture_output=True, timeout=10)
    except subprocess.TimeoutExpired:
        skipped.append(f'{name}: lcc timed out (waits for input or never halts)'); shutil.rmtree(tmp); continue
    shutil.rmtree(tmp)
    so = p.stdout.decode(errors='replace')
    m = re.search(r'^=+ Output\n', so, re.M)
    if not m:
        last = so.strip().splitlines()[-1] if so.strip() else f'exit {p.returncode}'
        if 'Empty file' in last:
            skipped.append(f'{name}: empty file'); continue
        # lcc rejected it at assembly time (e.g. the *test.a files use an older
        # dialect) — keep it as an error-parity case: the web assembler must reject it too
        open(os.path.join(out, name + '.error'), 'w').write(last + '\n')
        shutil.copy(os.path.join(src, fn), os.path.join(out, fn))
        errors += 1; continue
    prog = so[m.end():]
    if prog.endswith('\n'): prog = prog[:-1]          # lcc's own trailing newline
    open(os.path.join(out, name + '.expected'), 'w').write(prog)
    shutil.copy(os.path.join(src, fn), os.path.join(out, fn))
    kept += 1
with open(os.path.join(out, 'SKIPPED.txt'), 'w') as fh:
    fh.write('Programs from the cuh63 package not in this corpus, and why:\n\n' + '\n'.join(skipped) + '\n')
print(f'{kept} programs captured, {errors} assembly-error cases, {len(skipped)} skipped -> {out}')
