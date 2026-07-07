// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/elmRef.ts — one shared visual for "this text points at THAT element."
 *
 * Modals and dialogs constantly name the element they act on ("Painting
 * status pill — every row — when …", "Format cells — header"). As bare text
 * that name is easy to skim past and hard to tie back to the thing sitting in
 * the Structure tree. This module renders the same reference as a small badge:
 * the tree's own type-icon (a box for <div>, text-lines for <span>, …) next to
 * the element's name, so a glance connects the sentence to the element the user
 * clicked. (issue #143)
 *
 * The icon map here is the SINGLE source of truth — editor/treeView.ts imports
 * it too, so the badge and the tree can never drift apart. Matching them is the
 * entire point.
 *
 * Security: _elmName can arrive from imported/pasted JSON, so the name is only
 * ever written via textContent — never innerHTML (see .jules/sentinel.md).
 */

/** elmType → Fluent UI (ms-Icon) glyph, mirrored 1:1 in the Structure tree. */
export const ELM_ICONS: Record<string, string> = {
  div: 'CubeShape', span: 'PlainText', a: 'Link', img: 'Photo2',
  button: 'ButtonControl', p: 'AlignLeft', svg: 'Puzzle', path: 'Puzzle',
  filepreview: 'PreviewLink',
};

/** The tree's fallback glyph for anything unmapped (a plain container box). */
export const DEFAULT_ELM_ICON = 'CubeShape';

/**
 * The ms-Icon glyph name for an elmType, defaulting like the tree does.
 * elmType is untrusted (imported JSON), so we only honour OWN keys — a plain
 * bracket lookup on "toString"/"constructor" would return a prototype value and
 * poison the generated className.
 */
export const elmIconName = (elmType?: string): string =>
  elmType && Object.hasOwn(ELM_ICONS, elmType) ? ELM_ICONS[elmType] : DEFAULT_ELM_ICON;

type ElmLike = { _elmName?: string; elmType?: string };

/**
 * A single reference token: [type-icon] name (dim type). A named element leads
 * with its name and keeps the type as a dim suffix — exactly like a tree row;
 * an unnamed element shows its `<type>` alone (the same text `nameOf` prints).
 * Returns a fresh element each call.
 */
export function elementRefChip(el: ElmLike): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'wb-elmref';

  const icon = document.createElement('i');
  icon.className = `ms-Icon ms-Icon--${elmIconName(el.elmType)} wb-elmref-icon`;
  icon.setAttribute('aria-hidden', 'true');
  chip.appendChild(icon);

  // `||` (not `??`) so an empty-string elmType from malformed JSON also falls
  // back — matching elmIconName()'s empty-string handling, no "<>" badge.
  const type = el.elmType || 'element';
  const name = document.createElement('span');
  name.className = 'wb-elmref-name';

  if (el._elmName) {
    name.textContent = el._elmName;           // XSS-safe: never innerHTML
    const suffix = document.createElement('span');
    suffix.className = 'wb-elmref-type';
    suffix.textContent = type;
    chip.append(name, suffix);
    chip.title = `${el._elmName} — a <${type}> element in this formatter`;
  } else {
    name.textContent = `<${type}>`;
    chip.appendChild(name);
    chip.title = `an unnamed <${type}> element in this formatter`;
  }
  return chip;
}
