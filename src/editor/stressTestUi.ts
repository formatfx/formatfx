/**
 * editor/stressTestUi.ts — the Stress Test overlay (☰ → 🧪 Stress test).
 *
 * Renders the formatter being edited against the generated edge-case matrix
 * (core/stressTest.ts): empty state, max-length text, extreme dates, boundary
 * numbers (including thresholds mined from the formatter's own comparisons),
 * multi-value extremes, unicode/RTL. Rendering goes through the REAL renderer
 * with the same CFR resolution as the canvas, so what breaks here is what
 * breaks in production.
 *
 * READ-ONLY by contract: variants are throwaway rows; opening, browsing and
 * closing this overlay never touches state.rows, the document, the undo
 * stack, or autosave. The rendered rows are cloned to strip the renderer's
 * action handlers, so even a click inside a row is inert. The ONE mutation on
 * offer is the explicit "Add to my rows" button — a data edit like any Data
 * dock edit (rows live outside the undo stack by design).
 */

import { state } from './state';
import { createOverlay, type OverlayHandle } from './overlay';
import { renderElement, type RenderIssue } from '../core/renderer';
import { resolveColumnRef } from './previewCtx';
import { buildStressVariants, type StressRow } from '../core/stressTest';
import type { MockRow } from '../core/types';
import type { EvalContext } from '../core/expressions';

let handle: OverlayHandle | null = null;

export function closeStressTest(): void {
  handle?.close();
  handle = null;
}

export function openStressTest(toast: (msg: string) => void): void {
  closeStressTest();
  handle = createOverlay('wb-stress-overlay', closeStressTest);
  const overlay = handle.overlay;

  const panel = document.createElement('div');
  panel.className = 'wb-stress-panel';
  overlay.appendChild(panel);

  const head = document.createElement('div');
  head.className = 'wb-stress-head';
  head.innerHTML = `
    <span class="wb-stress-title">🧪 Stress test — will this break in production?</span>
    <span class="wb-stress-sub">Generated edge-case data, rendered with the real engine. Read-only: nothing here changes your workspace.</span>`;
  const close = document.createElement('button');
  close.className = 'wb-stress-close';
  close.textContent = '✕';
  close.title = 'Close (Esc)';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', closeStressTest);
  head.appendChild(close);
  panel.appendChild(head);

  const body = document.createElement('div');
  body.className = 'wb-stress-body';
  panel.appendChild(body);

  const variants = buildStressVariants(state.fields, {
    mineTrees: [state.doc.root, ...Object.values(state.columnRefs)],
  });

  let silentFailures = 0;
  for (const variant of variants) {
    const section = document.createElement('section');
    section.className = 'wb-stress-variant';
    const h = document.createElement('h3');
    h.textContent = variant.label;
    const desc = document.createElement('p');
    desc.className = 'wb-stress-desc';
    desc.textContent = variant.description;
    section.append(h, desc);
    variant.rows.forEach((sr, i) => {
      const { el, issueCount } = renderStressRow(sr, i, toast);
      silentFailures += issueCount;
      section.appendChild(el);
    });
    body.appendChild(section);
  }

  const foot = document.createElement('div');
  foot.className = 'wb-stress-foot';
  foot.textContent = silentFailures
    ? `⚠ ${silentFailures} silent failure${silentFailures === 1 ? '' : 's'} found — on real SharePoint these render blank with no error. The affected rows are flagged above.`
    : '✓ No silent failures — every generated variant rendered without an expression error.';
  foot.classList.toggle('wb-stress-foot-warn', silentFailures > 0);
  panel.appendChild(foot);

  document.body.appendChild(overlay);
}

function renderStressRow(sr: StressRow, rowIndex: number, toast: (msg: string) => void): { el: HTMLElement; issueCount: number } {
  const wrap = document.createElement('div');
  wrap.className = 'wb-stress-row';

  const side = document.createElement('div');
  side.className = 'wb-stress-row-side';
  const label = document.createElement('span');
  label.className = 'wb-stress-row-label';
  label.textContent = sr.label;
  const addBtn = document.createElement('button');
  addBtn.className = 'wb-stress-add';
  addBtn.textContent = '+ Add to my rows';
  addBtn.title = 'Copy this generated row into your mock data (an explicit data edit — the only way Stress Test ever writes anything)';
  addBtn.addEventListener('click', () => {
    state.rows.push(JSON.parse(JSON.stringify(sr.row)) as MockRow);
    state.emit('data');
    toast(`Added "${sr.label}" to your mock rows`);
  });
  side.append(label, addBtn);
  wrap.appendChild(side);

  const stage = document.createElement('div');
  stage.className = 'wb-stress-stage';
  const issues: RenderIssue[] = [];
  try {
    const rendered = renderElement(state.doc.root, ctxFor(sr.row, rowIndex), {
      tagPaths: false, resolveColumnRef, issues,
    });
    // clone strips customRowAction/customCardProps listeners — a misclick
    // inside the matrix must do nothing (read-only contract)
    stage.appendChild(rendered.cloneNode(true));
  } catch (e) {
    issues.push({ path: [], message: (e as Error).message });
    stage.textContent = '(nothing rendered)';
    stage.classList.add('wb-stress-stage-broken');
  }
  wrap.appendChild(stage);

  if (issues.length) {
    const note = document.createElement('div');
    note.className = 'wb-stress-issues';
    const unique = [...new Set(issues.map((i) => i.message))];
    note.textContent = `⚠ Breaks with this data (SP would render blank, silently): ${unique.join(' · ')}`;
    wrap.appendChild(note);
  }
  return { el: wrap, issueCount: issues.length };
}

/** Same shape as previewCtx.ctxForRow, but over a generated throwaway row. */
function ctxFor(row: MockRow, rowIndex: number): EvalContext {
  return {
    row,
    rowIndex,
    currentFieldName: state.currentFieldName,
    me: state.me,
    iterators: {},
    iteratorIndex: {},
    displayNames: Object.fromEntries(state.fields.map((f) => [f.name, f.displayName ?? f.name])),
    now: new Date(),
  };
}
