/** The theme button shows the mode it will switch TO (destination semantics). */
export function themeToggleView(mode: 'light' | 'dark'): { icon: string; label: string } {
  return mode === 'light'
    ? { icon: 'ClearNight', label: 'Switch to dark mode' }
    : { icon: 'Sunny', label: 'Switch to light mode' };
}
