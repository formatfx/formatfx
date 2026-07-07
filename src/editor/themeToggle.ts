// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/** The theme button shows the mode it will switch TO (destination semantics). */
export function themeToggleView(mode: 'light' | 'dark'): { icon: string; label: string } {
  return mode === 'light'
    ? { icon: 'ClearNight', label: 'Switch to dark mode' }
    : { icon: 'Sunny', label: 'Switch to light mode' };
}
