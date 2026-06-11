/**
 * core/renderer.ts — Renders an SPElement tree to real DOM, emulating the
 * SharePoint list-formatting renderer: expression evaluation, the style
 * allow-list (unsupported properties are dropped, exactly like SP), iconName
 * glyphs, forEach iteration, customCardProps flyouts and customRowAction stubs.
 */

import type { SPElement, SPExpr, NodePath } from './types';
import { ALLOWED_STYLES } from './schema';
import {
  evaluate, evaluateToString, toStr, parseForEach, evaluateForEachList,
  type EvalContext, type SPValue,
} from './expressions';

export interface RenderIssue {
  path: NodePath;
  message: string;
}

export interface RenderOptions {
  /** Called when the user triggers a customRowAction in preview. */
  onAction?: (el: SPElement, summary: string) => void;
  /** Collects runtime evaluation problems (SP would fail silently). */
  issues?: RenderIssue[];
  /** Stamp data-sp-path attributes for editor selection. */
  tagPaths?: boolean;
  /** Resolve a columnFormatterReference to another formatter tree. */
  resolveColumnRef?: (fieldRef: string) => SPElement | null;
  /** Internal: CFR names currently being rendered (cycle protection). */
  cfrStack?: string[];
}

function report(opts: RenderOptions, path: NodePath, message: string): void {
  opts.issues?.push({ path, message });
}

function safeEvalString(raw: SPExpr, ctx: EvalContext, opts: RenderOptions, path: NodePath, what: string): string {
  try {
    return evaluateToString(raw, ctx);
  } catch (e) {
    report(opts, path, `${what}: ${(e as Error).message}`);
    return '';
  }
}

function tagName(elmType: string): string {
  switch (elmType) {
    case 'filepreview': return 'img';
    case 'svg': case 'path': return elmType;
    default:
      return ['div', 'span', 'a', 'img', 'button', 'p'].includes(elmType) ? elmType : 'div';
  }
}

export function renderElement(
  el: SPElement,
  ctx: EvalContext,
  opts: RenderOptions = {},
  path: NodePath = [],
): HTMLElement | SVGElement {
  // forEach — expand into a fragment-like wrapper handled by the caller via children loop
  const isSvg = el.elmType === 'svg' || el.elmType === 'path';
  const node = isSvg
    ? document.createElementNS('http://www.w3.org/2000/svg', el.elmType)
    : document.createElement(tagName(el.elmType ?? 'div'));

  if (opts.tagPaths) {
    (node as HTMLElement).dataset.spPath = path.join('.');
  }

  // attributes
  if (el.attributes) {
    for (const [key, raw] of Object.entries(el.attributes)) {
      if (raw === undefined || raw === null) continue;
      const value = safeEvalString(raw, ctx, opts, path, `attributes.${key}`);
      if (key === 'class') {
        for (const cls of value.split(/\s+/).filter(Boolean)) node.classList.add(cls);
      } else if (key === 'iconName') {
        if (value) {
          const icon = document.createElement('i');
          icon.className = `ms-Icon ms-Icon--${value}`;
          icon.setAttribute('aria-hidden', 'true');
          node.insertBefore(icon, node.firstChild);
        }
      } else if (key === 'href' || key === 'src') {
        node.setAttribute(key, value);
        if (key === 'href') node.setAttribute('rel', 'noopener noreferrer');
      } else {
        try { node.setAttribute(key, value); } catch { /* invalid attr name */ }
      }
    }
  }

  // style — enforce the SP allow-list (unsupported props silently dropped, as SP does)
  if (el.style) {
    for (const [prop, raw] of Object.entries(el.style)) {
      if (prop === '_comment') continue;
      if (raw === undefined || raw === null) continue;
      if (!ALLOWED_STYLES.has(prop) && !prop.startsWith('--inline-editor')) continue;
      const value = safeEvalString(raw, ctx, opts, path, `style.${prop}`);
      (node as HTMLElement).style?.setProperty(prop, value);
    }
  }

  // text content
  if (el.txtContent !== undefined) {
    const text = safeEvalString(el.txtContent, ctx, opts, path, 'txtContent');
    node.appendChild(document.createTextNode(text));
  }

  // inlineEditField indicator
  if (el.inlineEditField) {
    node.classList.add('wb-inline-edit');
    node.setAttribute('title', `inlineEditField: ${el.inlineEditField}`);
  }

  // columnFormatterReference
  if (el.columnFormatterReference) {
    const refName = el.columnFormatterReference;
    const stack = opts.cfrStack ?? [];
    const cyclic = stack.includes(refName);
    const refTree = cyclic ? null : opts.resolveColumnRef?.(refName) ?? null;
    if (refTree) {
      // inside the referenced formatter, @currentField is the REFERENCED column
      const refField = refName.replace(/^\[\$?/, '').replace(/\]$/, '').replace(/^\$/, '');
      const refCtx: EvalContext = { ...ctx, currentFieldName: refField };
      node.appendChild(renderElement(refTree, refCtx, {
        ...opts, tagPaths: false, cfrStack: [...stack, refName],
      }, path));
    } else {
      const chip = document.createElement('span');
      chip.className = 'wb-cfr-chip';
      chip.textContent = `⤷ ${refName}`;
      chip.title = cyclic
        ? `Circular columnFormatterReference: ${[...stack, refName].join(' → ')}`
        : 'columnFormatterReference — register this column\'s formatter in the Data tab ("Column formatter references") to render it inline. On a real list the referenced column must be present in the view.';
      node.appendChild(chip);
    }
  }

  // customRowAction — stub with toast
  if (el.customRowAction) {
    node.classList.add('wb-clickable');
    const action = el.customRowAction;
    node.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      let summary = `customRowAction: ${action.action || '(no-op)'}`;
      if (action.action === 'setValue' && action.actionInput && typeof action.actionInput === 'object') {
        summary += ' → ' + Object.entries(action.actionInput).map(([k, v]) => `${k}=${toStr(evalSafe(v, ctx))}`).join(', ');
      } else if (action.action === 'executeFlow') {
        summary += ` → ${typeof action.actionParams === 'string' ? action.actionParams : ''}`;
      }
      opts.onAction?.(el, summary);
    });
  }

  // customCardProps — emulated flyout (card content addressed as [...path, -1])
  if (el.customCardProps) {
    node.classList.add('wb-has-card');
    const cardProps = el.customCardProps;
    const open = (anchor: HTMLElement) =>
      openFlyout(anchor, cardProps.formatter, ctx, opts, cardProps.directionalHint, [...path, -1], cardProps.isBeakVisible !== false);
    if (cardProps.openOnEvent === 'hover') {
      let timer = 0;
      node.addEventListener('mouseenter', () => { timer = window.setTimeout(() => open(node as HTMLElement), 300); });
      node.addEventListener('mouseleave', () => window.clearTimeout(timer));
    } else {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        open(node as HTMLElement);
      });
    }
  }

  // children / forEach
  if (el.children?.length) {
    el.children.forEach((child, i) => {
      const childPath = [...path, i];
      if (child.forEach) {
        const binding = parseForEach(child.forEach);
        if (!binding) {
          report(opts, childPath, `Invalid forEach binding: "${child.forEach}"`);
          return;
        }
        let list: SPValue[] = [];
        try {
          list = evaluateForEachList(binding.listExpr, ctx);
        } catch (e) {
          report(opts, childPath, `forEach list: ${(e as Error).message}`);
        }
        list.forEach((item, idx) => {
          const childCtx: EvalContext = {
            ...ctx,
            iterators: { ...ctx.iterators, [binding.iterator]: item },
            iteratorIndex: { ...ctx.iteratorIndex, [binding.iterator]: idx },
          };
          node.appendChild(renderElement(child, childCtx, opts, childPath));
        });
        if (list.length === 0 && opts.tagPaths) {
          // keep an invisible anchor so the node stays selectable in the editor
          const ghost = document.createElement('span');
          ghost.className = 'wb-foreach-empty';
          ghost.dataset.spPath = childPath.join('.');
          ghost.textContent = '∅ forEach';
          ghost.title = `forEach "${child.forEach}" produced 0 items for this row`;
          node.appendChild(ghost);
        }
      } else {
        node.appendChild(renderElement(child, ctx, opts, childPath));
      }
    });
  }

  return node;
}

function evalSafe(v: unknown, ctx: EvalContext): SPValue {
  if (typeof v !== 'string') return v as SPValue;
  try { return evaluate(v, ctx); } catch { return v; }
}

// ─── Flyout (customCardProps emulation) ─────────────────────────────────────

let activeFlyout: HTMLElement | null = null;

export function closeFlyout(): void {
  activeFlyout?.remove();
  activeFlyout = null;
}

function openFlyout(
  anchor: HTMLElement,
  formatter: SPElement,
  ctx: EvalContext,
  opts: RenderOptions,
  hint?: string,
  cardPath: NodePath = [],
  beak = true,
): void {
  closeFlyout();
  const fly = document.createElement('div');
  fly.className = 'wb-flyout';
  fly.appendChild(renderElement(formatter, ctx, opts, cardPath));
  document.body.appendChild(fly);
  const r = anchor.getBoundingClientRect();
  const fr = fly.getBoundingClientRect();
  let top = r.bottom + 8, left = r.left + r.width / 2 - fr.width / 2;
  let beakSide = 'top'; // flyout below anchor → beak points up from the flyout's top edge
  if (hint?.startsWith('top')) { top = r.top - fr.height - 8; beakSide = 'bottom'; }
  if (hint?.startsWith('right')) { left = r.right + 8; top = r.top; beakSide = 'left'; }
  if (hint?.startsWith('left')) { left = r.left - fr.width - 8; top = r.top; beakSide = 'right'; }
  fly.style.top = `${Math.max(4, top + window.scrollY)}px`;
  fly.style.left = `${Math.max(4, Math.min(left, window.innerWidth - fr.width - 8))}px`;
  if (beak) {
    const b = document.createElement('div');
    b.className = `wb-flyout-beak wb-flyout-beak-${beakSide}`;
    fly.appendChild(b);
  }
  activeFlyout = fly;
  window.setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!fly.contains(e.target as Node)) {
        closeFlyout();
        document.removeEventListener('click', handler);
      }
    });
  }, 0);
}
