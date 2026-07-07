// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Sam Yost. FormatFX is dual-licensed: AGPL-3.0 (see LICENSE) or a commercial license (see LICENSING.md).

/**
 * editor/codeEditor.ts — the Code lens DOM shell over codeMode.ts.
 *
 * A monospace declarations box: reads the selected element's style + attributes
 * as `prop: value;` / `@name: value;` lines, parses on blur/change, and commits
 * via one undoable mutation. Parse errors surface in a banner and never corrupt
 * the node (invalid lines are simply skipped; valid ones still apply).
 *
 * #222: typing `@` or `[$` inside a declaration VALUE opens the tokenized
 * SP-context typeahead (system tokens + internal-name column refs, with
 * inline docs and live mock previews) — the same menu the fx bar shows,
 * driven by the pure spCompletionAt(). `@name` at the start of a line is an
 * attribute, not a token, so it never triggers.
 */

import { state } from './state';
import {
  nodeToDeclarations, parseDeclarations, applyDeclarations, CODE_HINT,
} from './codeMode';
import { spCompletionAt, type CompletionOpts } from './fxSuggest';
import { openAcMenu, type AcMenu } from './acMenu';
import { ctxForRow } from './previewCtx';

export function mountCodeEditor(host: HTMLElement): void {
  host.classList.add('wb-codelens');
  host.innerHTML = `
    <textarea class="wb-code-box" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea>
    <div class="wb-code-errors" role="alert" hidden></div>
    <div class="wb-code-hint">${CODE_HINT}</div>
  `;
  const box = host.querySelector<HTMLTextAreaElement>('.wb-code-box')!;
  const errs = host.querySelector<HTMLDivElement>('.wb-code-errors')!;
  let dirty = false; // user is mid-edit — don't clobber the textarea
  let ac: AcMenu | null = null; // the tokenized-context typeahead, when open

  const closeAc = (): void => { if (ac) { ac.close(); ac = null; } };
  const acOpts = (): CompletionOpts => ({
    current: state.fields.find((f) => f.name === state.currentFieldName),
    ctx: state.rows.length ? ctxForRow(0) : undefined,
  });
  const updateAc = (): void => {
    closeAc();
    const caret = box.selectionStart ?? box.value.length;
    const comp = spCompletionAt(box.value, caret, state.fields, acOpts());
    if (!comp || comp.items.length === 0) return;
    ac = openAcMenu(box, comp.items, (value) => {
      const v = box.value;
      box.value = v.slice(0, comp.from) + value + v.slice(comp.to);
      dirty = true;
      const pos = comp.from + value.length;
      box.setSelectionRange(pos, pos);
      box.focus();
      updateAc(); // chain: '@currentField' may still want its '.email'
    });
  };

  const render = (): void => {
    if (dirty) return;
    closeAc();
    const node = state.selectedNode;
    if (!node) {
      box.value = '';
      box.disabled = true;
      box.placeholder = 'Select an element to edit its declarations.';
      errs.hidden = true;
      return;
    }
    box.disabled = false;
    box.value = nodeToDeclarations(node);
    errs.hidden = true;
  };

  const commit = (): void => {
    if (!dirty) return;
    const path = state.selection;
    const node = path ? state.nodeAt(path) : null;
    if (!path || !node) { dirty = false; return; }
    const parsed = parseDeclarations(box.value);
    if (parsed.errors.length) {
      // Never corrupt the node: surface the errors and keep the text dirty so the
      // user can fix it. Do NOT apply a partial parse — otherwise an all-malformed
      // buffer would clear style/attributes/txtContent/forEach and lose the values.
      errs.hidden = false;
      errs.textContent = parsed.errors
        .map((e) => `Line ${e.line}: ${e.message}`)
        .join('  ·  ');
      return;
    }
    errs.hidden = true;
    dirty = false; // applied — let the re-render reformat to canonical
    state.mutateDocument(() => {
      state.selections.forEach((p) => {
        const n = state.nodeAt(p);
        if (n) applyDeclarations(n, parsed);
      });
    });
  };

  box.addEventListener('input', () => { dirty = true; updateAc(); });
  box.addEventListener('change', commit);
  box.addEventListener('blur', () => { closeAc(); commit(); });
  box.addEventListener('keydown', (e) => {
    if (!ac) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); ac.move(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); ac.move(-1); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeAc(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (ac.accept()) e.preventDefault(); // accept instead of newline / focus move
    }
  });

  const hostAny = host as any;
  if (typeof hostAny._unsub === 'function') {
    hostAny._unsub();
  }
  hostAny._unsub = state.subscribe((reason) => {
    if (reason === 'selection' || reason === 'load' || reason === 'document' || reason === 'lens') {
      // a fresh selection / external doc change supersedes any in-progress edit
      if (reason !== 'document') dirty = false;
      render();
    }
  });
  render();
}
