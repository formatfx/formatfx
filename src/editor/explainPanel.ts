// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0-only (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/explainPanel.ts — the Explain tab (Advanced pane, peer of JSON).
 *
 * Reads the formatter on the canvas back in plain English via
 * core/explain.ts: one card per element that has something to say, each line
 * a sentence ("If Status is 'Blocked', the background color turns …",
 * "Clicking runs the Power Automate flow …"). Clicking a card selects its
 * element by NodePath — exactly how lint warnings navigate. Parts outside
 * Explain's vocabulary say so honestly (refuse-don't-guess), styled as such.
 */

import { state } from './state';
import { explainDocument, type ExplainEntry } from '../core/explain';
import { detectKindLabel } from '../core/serializer';

export function mountExplainPanel(host: HTMLElement): void {
  const hostAny = host as any;
  if (typeof hostAny._unsub === 'function') hostAny._unsub();

  host.innerHTML = `
    <div class="wb-explain-intro" id="wb-explain-intro"></div>
    <div class="wb-explain-list" id="wb-explain-list"></div>
  `;
  const introEl = host.querySelector('#wb-explain-intro') as HTMLElement;
  const listEl = host.querySelector('#wb-explain-list') as HTMLElement;

  const refresh = (): void => {
    const entries = explainDocument(state.doc, {
      displayNames: Object.fromEntries(state.fields.map((f) => [f.name, f.displayName ?? f.name])),
      currentFieldName: state.currentFieldName,
    });
    introEl.textContent = introText(entries);
    listEl.innerHTML = '';
    for (const entry of entries) listEl.appendChild(renderEntry(entry));
  };

  hostAny._unsub = state.subscribe((reason) => {
    if (reason === 'document' || reason === 'load' || reason === 'kind' || reason === 'data') refresh();
  });
  refresh();
}

function introText(entries: ExplainEntry[]): string {
  const kind = detectKindLabel(state.doc.kind);
  if (!entries.length) {
    return `${kind}. Nothing to explain yet — no text, conditions, links or actions in this formatter.`;
  }
  const refusals = entries.reduce((n, e) => n + e.lines.filter((l) => l.unexplained).length, 0);
  return `${kind}, read back in plain English. Click a card to select that element.`
    + (refusals ? ` ${refusals} part${refusals === 1 ? '' : 's'} fall outside Explain's vocabulary and say so — nothing here is guessed.` : '');
}

function renderEntry(entry: ExplainEntry): HTMLElement {
  const card = document.createElement('div');
  card.className = 'wb-explain-entry';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.title = `Click to select ${entry.label} on the canvas`;
  const jump = (): void => state.select(entry.path);
  card.addEventListener('click', jump);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
  });

  const name = document.createElement('div');
  name.className = 'wb-explain-name';
  name.textContent = entry.label;
  card.appendChild(name);

  for (const line of entry.lines) {
    const p = document.createElement('div');
    p.className = 'wb-explain-line' + (line.unexplained ? ' wb-explain-unexplained' : '');
    p.textContent = line.text;
    card.appendChild(p);
  }
  return card;
}
