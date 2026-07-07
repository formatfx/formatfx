/**
 * core/renderer.ts — Renders an SPElement tree to real DOM, emulating the
 * SharePoint list-formatting renderer: expression evaluation, the style
 * allow-list (unsupported properties are dropped, exactly like SP), iconName
 * glyphs, forEach iteration, customCardProps flyouts and customRowAction stubs.
 */

import type { SPElement, SPExpr, NodePath } from './types';
import { ALLOWED_STYLES, ALLOWED_ATTRIBUTES } from './schema';
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
  /** FLOOR-AND-SHEETS Stage 3 (the Select/Live canvas): when false, the
   *  customRowAction click handler is NOT attached, so a click on an action
   *  button bubbles up to the editor's click-to-select instead of firing the
   *  behavior. Defaults to true (live) — headless/preview consumers keep the
   *  real behaviors without opting in. Card flyouts stay attached in BOTH
   *  modes: the flyout is also the editing door into customCardProps. */
  interactive?: boolean;
  /** Collects runtime evaluation problems (SP would fail silently). */
  issues?: RenderIssue[];
  /** Stamp data-sp-path attributes for editor selection. */
  tagPaths?: boolean;
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

const ATTR_ALLOW = new Set<string>(ALLOWED_ATTRIBUTES);

/** SP only honors a fixed set of attributes (plus aria-*); everything else —
 *  notably on* event handlers — is ignored. We mirror that so an imported or
 *  pasted formatter can't inject a handler into the preview's DOM. */
function isAllowedAttribute(key: string): boolean {
  return ATTR_ALLOW.has(key) || key.startsWith('aria-');
}

/** URL guard for href/src: permit relative URLs, http(s)/mailto/tel, and inert
 *  image data URIs (the avatar generator emits data:image/svg+xml). Drop
 *  javascript:/vbscript:/data:text-html and anything else that could execute.
 *  Returns the value to set, or null to drop. Control chars are stripped first
 *  because browsers ignore them when resolving the scheme (java\nscript:…). */
function safeUrl(value: string): string | null {
  const v = value.replace(/[\x00-\x1F]/g, '').trim();
  if (v === '') return value;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(v);
  if (!scheme) return value; // relative path, anchor or query — no scheme
  const s = scheme[1].toLowerCase();
  if (s === 'http' || s === 'https' || s === 'mailto' || s === 'tel') return value;
  if (s === 'data') return /^data:image\//i.test(v) ? value : null;
  return null; // javascript:, vbscript:, file:, data:text/html, …
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
      // Ignore attributes SP wouldn't honor (esp. on* event handlers) — the
      // renderer drops them just as it drops non-allow-listed styles below.
      if (!isAllowedAttribute(key)) continue;
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
        const url = safeUrl(value);
        if (url !== null) node.setAttribute(key, url);
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

  // customRowAction — stub with toast (Select mode skips the handler so the
  // click can select the button instead of firing it — Stage 3)
  if (el.customRowAction && opts.interactive !== false) {
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
