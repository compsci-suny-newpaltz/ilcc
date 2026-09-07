import { useEffect, useState } from 'react';

export const DEBUG_COLOR_SCHEMES = [
  { id: 'default', label: 'Default' },
  { id: 'high-contrast', label: 'High contrast' },
  { id: 'colorblind', label: 'Colorblind friendly' },
];

const STORAGE_KEY = 'ilcc-debug-colors';
const DEFAULT_SCHEME = 'default';

const COLORS = {
  default: {
    line: 'rgba(37, 99, 235, 0.22)', change: 'rgba(22, 163, 74, 0.14)',
    flash: 'rgba(22, 163, 74, 0.30)', old: '#dc2626', new: '#16a34a',
  },
  'high-contrast': {
    line: 'rgba(245, 158, 11, 0.28)', change: 'rgba(14, 116, 144, 0.16)',
    flash: 'rgba(14, 116, 144, 0.30)', old: '#b91c1c', new: '#047857',
  },
  colorblind: {
    line: 'rgba(0, 114, 178, 0.28)', change: 'rgba(0, 114, 178, 0.18)',
    flash: 'rgba(0, 114, 178, 0.34)', old: '#d55e00', new: '#0072b2',
  },
};

export default function useDebugColors() {
  const [scheme, setSchemeState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return COLORS[saved] ? saved : DEFAULT_SCHEME;
  });

  useEffect(() => {
    const root = document.documentElement;
    const colors = COLORS[scheme] || COLORS[DEFAULT_SCHEME];
    root.style.setProperty('--debug-line', colors.line);
    root.style.setProperty('--debug-change', colors.change);
    root.style.setProperty('--debug-flash', colors.flash);
    root.style.setProperty('--debug-old', colors.old);
    root.style.setProperty('--debug-new', colors.new);
    localStorage.setItem(STORAGE_KEY, scheme);
  }, [scheme]);

  return { debugColorScheme: scheme, setDebugColorScheme: setSchemeState, debugColorSchemes: DEBUG_COLOR_SCHEMES };
}
