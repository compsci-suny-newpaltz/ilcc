/*
 * Stack.jsx — Stack memory viewer panel.
 *
 * Shows a window of memory addresses around the current stack pointer (sp = r6),
 * extending up to 0xffff so the bottom of the stack is always visible.
 *
 * Rows are rendered immediately on session start (all zeros) using the top
 * of the stack area (near 0xffff) as the default view when sp is not yet set.
 *
 * Layout per row:   [pointer tag]  [address]  [value]
 *
 * Pointer tags:
 *   sp>   (green) — current stack pointer (r6)
 *   fp>   (green) — current frame pointer (r5)
 *   fpsp> (green) — fp and sp coincide at this address
 *   sp>   (red)   — previous sp location, shown for one step after sp moves
 *   fp>   (red)   — previous fp location, shown for one step after fp moves
 *   fpsp> (red)   — previous location where both fp and sp coincided
 *
 * Values that changed during the last step are highlighted as "old > new".
 *
 * Props:
 *   debugState — latest diff from useDebugSession (null before first step).
 *   memoryMap  — { [addr: number]: number } accumulated cell values.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import styles from './Stack.module.css';
import { ADDRESS_COUNT, ROW_HEIGHT, OVERSCAN, scrollAddressIntoView } from './virtualMemory';

/* ── helpers ─────────────────────────────────────────────────────────────── */

const hex4 = (v) => (v >>> 0).toString(16).padStart(4, '0');

function DiffVal({ change, plain }) {
  if (change && change.old !== change.new) {
    return (
      <span className={styles.diffGroup}>
        <span className={styles.old}>{hex4(change.old)}</span>
        <span className={styles.sep}>&gt;</span>
        <span className={styles.new}>{hex4(change.new)}</span>
      </span>
    );
  }
  return <span className={styles.value}>{hex4(plain)}</span>;
}

function parseHex(s) {
  const clean = s.trim().replace(/^0x/i, '');
  const v = parseInt(clean, 16);
  return isNaN(v) ? null : (v & 0xffff);
}

/* ── component ───────────────────────────────────────────────────────────── */

export default function Stack({ debugState, memoryMap = {}, isDebugging = false }) {
  const [jumpInput, setJumpInput] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const contentRef = useRef(null);

  const sp    = debugState?.registers[6]?.new ?? 0;
  const spOld = debugState?.registers[6]?.old ?? 0;
  const fp    = debugState?.registers[5]?.new ?? 0;
  const fpOld = debugState?.registers[5]?.old ?? 0;

  /* Build a fast lookup for cells that changed THIS step. */
  const changesThisStep = new Map();
  for (const ch of (debugState?.memory ?? [])) {
    changesThisStep.set(ch.addr, ch);
  }

  const firstVisible = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil((viewportHeight || ROW_HEIGHT * 20) / ROW_HEIGHT) + OVERSCAN * 2;
  const visibleAddrs = useMemo(
    () => Array.from({ length: Math.min(ADDRESS_COUNT - firstVisible, visibleCount) }, (_, i) => firstVisible + i),
    [firstVisible, visibleCount],
  );

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const update = () => {
      setScrollTop(el.scrollTop);
      setViewportHeight(el.clientHeight);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => { el.removeEventListener('scroll', update); observer.disconnect(); };
  }, []);

  /* Start at the top of the stack (the high end of memory), but preserve the
     user's position while stepping. */
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    if (!isDebugging) return;
    const id = setTimeout(() => {
      /* The virtualized content has now laid out; use the exact maximum
         scroll offset so the view always ends at address 0xffff. */
      el.scrollTop = el.scrollHeight - el.clientHeight;
    }, 0);
    return () => clearTimeout(id);
  }, [isDebugging]);

  function jumpToAddress() {
    const target = parseHex(jumpInput);
    if (target !== null) scrollAddressIntoView(contentRef.current, target);
  }

  function handleJump(e) {
    if (e.key === 'Enter') jumpToAddress();
  }

  function jumpToRegister(value) {
    scrollAddressIntoView(contentRef.current, value);
  }

  if (!isDebugging) {
    return (
      <div className={styles.panel}>
        <span className={styles.empty}>No stack data yet</span>
      </div>
    );
  }

  return (
    <div className={styles.panel}>

      {/* Column header — outside scroll */}
      <div className={styles.tableHeader}>
        <span className={styles.tagSpacer} />
        <span className={styles.colAddr}>addr</span>
        <span className={styles.colValue}>value</span>
      </div>

      {/* Scrollable rows — always rendered; all zeros before first step */}
      <div className={styles.content} ref={contentRef}>
        <div style={{ height: ADDRESS_COUNT * ROW_HEIGHT, flexShrink: 0, position: 'relative' }}>
          <div style={{ position: 'absolute', top: firstVisible * ROW_HEIGHT, left: 0, right: 0 }}>
        {visibleAddrs.map(addr => {
          const isSp    = addr === sp;
          const isFp    = addr === fp;
          /* Previous locations — shown in red for one step after the pointer moves. */
          const isOldSp = sp !== 0 && spOld !== 0 && spOld !== sp && addr === spOld;
          const isOldFp = fp !== 0 && fpOld !== 0 && fpOld !== fp && addr === fpOld;

          /* Current-position tags take priority over old-position tags.
             Within old tags, the combined fpsp> label fires when both old
             pointers happened to share the same address. */
          let tag = '', tagClass = styles.pointerTag;
          if      (isSp && isFp)       { tag = 'fp sp>'; }
          else if (isSp)               { tag = 'sp>'; }
          else if (isFp)               { tag = 'fp>'; }
          else if (isOldSp && isOldFp) { tag = 'fp sp>'; tagClass = styles.pointerTagOld; }
          else if (isOldSp)            { tag = 'sp>';   tagClass = styles.pointerTagOld; }
          else if (isOldFp)            { tag = 'fp>';   tagClass = styles.pointerTagOld; }

          const change = changesThisStep.get(addr);
          const val    = memoryMap[addr] ?? 0;

          return (
            <div
              key={addr}
              className={`${styles.row} ${change ? styles.changed : ''}`}
            >
              <span className={tagClass}>{tag}</span>
              <span className={styles.address}>{hex4(addr)}</span>
              <DiffVal change={change} plain={val} />
            </div>
          );
        })}
          </div>
        </div>
      </div>

      {/* Jump-to-address bar */}
      <div className={styles.jumpBar}>
        <button className={styles.jumpLabel} type="button" onClick={jumpToAddress}>Jump</button>
        <input
          className={styles.jumpInput}
          type="text"
          placeholder="0xaddr"
          value={jumpInput}
          onChange={e => setJumpInput(e.target.value)}
          onKeyDown={handleJump}
          spellCheck={false}
          aria-label="Jump to stack address"
        />
        <button className={styles.jumpButton} type="button" onClick={() => jumpToRegister(fp)} title="Jump to frame pointer">FP</button>
        <button className={styles.jumpButton} type="button" onClick={() => jumpToRegister(sp)} title="Jump to stack pointer">SP</button>
      </div>

    </div>
  );
}
