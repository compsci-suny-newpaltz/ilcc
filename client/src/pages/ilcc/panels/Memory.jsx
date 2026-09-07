/*
 * Memory.jsx — Program memory viewer panel.
 *
 * Shows every address in the program area (addr ≤ 0x7fff) that has been
 * written to (or was present at load time via memory_init), sorted ascending.
 *
 * Jump bar: type any hex address, press Enter — scrolls to the exact row
 * if it exists, otherwise to the nearest written address above the target.
 *
 * After each step, automatically scrolls to the first written address that
 * changed, so you always see the effect of a memory write without hunting.
 *
 * Values that changed during the last step are shown as "old > new".
 *
 * Props:
 *   debugState — latest diff from useDebugSession (null before first step).
 *   memoryMap  — { [addr: number]: number } accumulated cell values.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import styles from './Memory.module.css';
import { ADDRESS_COUNT, ROW_HEIGHT, OVERSCAN, scrollAddressIntoView } from './virtualMemory';

/* ── helpers ─────────────────────────────────────────────────────────────── */

const hex4 = (v) => (v >>> 0).toString(16).padStart(4, '0');

function parseHex(s) {
  const clean = s.trim().replace(/^0x/i, '');
  const v = parseInt(clean, 16);
  return isNaN(v) ? null : (v & 0xffff);
}

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

/* ── component ───────────────────────────────────────────────────────────── */

export default function Memory({ debugState, memoryMap = {}, isDebugging = false, loadPoint = 0 }) {
  const [jumpInput, setJumpInput] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const contentRef = useRef(null);

  /* Current-step changes, filtered to program area. */
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

  useEffect(() => {
    const el = contentRef.current;
    if (!el || !isDebugging) return;
    const id = setTimeout(() => {
      scrollAddressIntoView(el, loadPoint, 'instant');
    }, 0);
    return () => clearTimeout(id);
  }, [isDebugging, loadPoint]);

  /* Jump: exact match, or nearest written address >= target. */
  function jumpToAddress() {
    const target = parseHex(jumpInput);
    if (target === null) return;
    scrollAddressIntoView(contentRef.current, target);
  }

  function handleJump(e) {
    if (e.key === 'Enter') jumpToAddress();
  }

  function jumpToPc() {
    if (pc === null) return;
    scrollAddressIntoView(contentRef.current, pc);
  }

  const pc    = debugState?.pc?.new ?? null;
  const pcOld = debugState?.pc?.old ?? null;

  if (!isDebugging) {
    return (
      <div className={styles.panel}>
        <span className={styles.empty}>No memory writes yet</span>
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

      {/* Scrollable content */}
      <div className={styles.content} ref={contentRef}>
        <div style={{ height: ADDRESS_COUNT * ROW_HEIGHT, flexShrink: 0, position: 'relative' }}>
          <div style={{ position: 'absolute', top: firstVisible * ROW_HEIGHT, left: 0, right: 0 }}>
          {visibleAddrs.map(addr => {
            const change = changesThisStep.get(addr);
            const val    = memoryMap[addr] ?? 0;

            const isPc    = pc    !== null && addr === pc;
            const isOldPc = pcOld !== null && pcOld !== pc && addr === pcOld;
            const tagText  = (isPc || isOldPc) ? 'pc>' : '';
            const tagClass = isPc ? styles.pointerTag : isOldPc ? styles.pointerTagOld : styles.tag;

            return (
              <div
                key={addr}
                className={`${styles.row} ${change ? styles.changed : ''}`}
              >
                <span className={tagClass}>{tagText}</span>
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
          aria-label="Jump to memory address"
        />
        <button className={styles.jumpButton} type="button" onClick={jumpToPc} disabled={pc === null} title="Jump to program counter">PC</button>
      </div>
    </div>
  );
}
