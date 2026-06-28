/**
 * editor/codeEditor.ts — the Code lens DOM shell over codeMode.ts.
 *
 * A monospace declarations box: reads the selected element's style + attributes
 * as `prop: value;` / `@name: value;` lines, parses on blur/change, and commits
 * via one undoable mutation. Parse errors surface in a banner and never corrupt
 * the node (invalid lines are simply skipped; valid ones still apply).
 */

import { state } from './state';
import {
  nodeToDeclarations, parseDeclarations, applyDeclarations, CODE_HINT,
} from './codeMode';

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

  const render = (): void => {
    if (dirty) return;
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
      const n = state.nodeAt(path);
      if (n) applyDeclarations(n, parsed);
    });
  };

  box.addEventListener('input', () => { dirty = true; });
  box.addEventListener('change', commit);
  box.addEventListener('blur', commit);

  state.subscribe((reason) => {
    if (reason === 'selection' || reason === 'load' || reason === 'document' || reason === 'lens') {
      // a fresh selection / external doc change supersedes any in-progress edit
      if (reason !== 'document') dirty = false;
      render();
    }
  });
  render();
}
