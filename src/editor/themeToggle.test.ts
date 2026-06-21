import { describe, it, expect } from 'vitest';
import { themeToggleView } from './themeToggle';

describe('themeToggleView', () => {
  it('in light mode, offers the dark destination', () => {
    expect(themeToggleView('light')).toEqual({ icon: 'ClearNight', label: 'Switch to dark mode' });
  });
  it('in dark mode, offers the light destination', () => {
    expect(themeToggleView('dark')).toEqual({ icon: 'Sunny', label: 'Switch to light mode' });
  });
});
