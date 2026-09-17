/**
 * panelShell.ts — the panel's chrome inside its shadow root (spec §2.2, §5):
 * a right-side rail sized for the editor with an expand-to-full-page toggle;
 * left the tree, right the editor, bottom Apply + History. No preview shapes
 * the layout.
 *
 * The shadow host stops keydown/keyup/keypress in the BUBBLE phase for every
 * key: SharePoint's document-level handler cancels plain `g` (a page
 * shortcut) and the shadow root retargets events so it cannot tell a
 * textarea is focused (spike answer 3). Undo/redo shortcuts are re-bound
 * here because main.ts's document listener never sees them now.
 */
const KEY_EVENTS = ['keydown', 'keyup', 'keypress'] as const;

export interface ShellHandlers { onClose(): void; onUndo(): void; onRedo(): void }
export interface Shell {
  app: HTMLElement; title: HTMLElement; tree: HTMLElement; editor: HTMLElement; banner: HTMLElement;
  footer: HTMLElement; drawer: HTMLElement; status: HTMLElement;
  undoBtn: HTMLButtonElement; redoBtn: HTMLButtonElement;
  setExpanded(on: boolean): void;
  notice(text: string | null): void;
  destroy(): void;
}

const SHELL_CSS = `
.ffx-app { position: fixed; top: 0; right: 0; height: 100vh; width: min(760px, 100vw); z-index: 1000000;
  display: flex; flex-direction: column; background: var(--wb-bg); color: var(--wb-text);
  border-left: 1px solid var(--wb-border); box-shadow: -8px 0 24px rgba(0,0,0,.18); font-size: 13px; }
.ffx-app.ffx-full { width: 100vw; border-left: 0; }
.ffx-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--wb-border); background: var(--wb-surface); }
.ffx-title { flex: 1; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ffx-head button, .ffx-foot button { font: inherit; padding: 4px 10px; border: 1px solid var(--wb-border); border-radius: 4px; background: var(--wb-surface); color: inherit; cursor: pointer; }
.ffx-head button:disabled, .ffx-foot button:disabled { opacity: .5; cursor: default; }
.ffx-body { flex: 1; display: flex; min-height: 0; }
.ffx-tree { width: 220px; overflow: auto; border-right: 1px solid var(--wb-border); padding: 6px 0; }
.ffx-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.ffx-banner { padding: 6px 12px; background: var(--wb-surface); border-bottom: 1px solid var(--wb-border); }
.ffx-editor { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ffx-editor > * { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.ffx-foot { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--wb-border); background: var(--wb-surface); }
.ffx-status { flex: 1; color: var(--wb-text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ffx-drawer { max-height: 40vh; overflow: auto; border-top: 1px solid var(--wb-border); padding: 8px 12px; }
.ffx-apply { font-weight: 600; }
`;

export function mountShell(shadow: ShadowRoot, css: string, h: ShellHandlers): Shell {
  const style = document.createElement('style');
  style.textContent = ':host { all: initial; }\n' + css + '\n' + SHELL_CSS;
  const app = document.createElement('div');
  app.className = 'ffx-app';
  app.innerHTML = `
    <div class="ffx-head">
      <span class="ffx-title">FormatFX</span>
      <button class="ffx-undo" title="Undo (Ctrl+Z)" disabled>↶</button>
      <button class="ffx-redo" title="Redo (Ctrl+Y)" disabled>↷</button>
      <button class="ffx-expand" title="Expand to the full page">⤢</button>
      <button class="ffx-close" title="Close the panel">✕</button>
    </div>
    <div class="ffx-body">
      <div class="ffx-tree" role="tree"></div>
      <div class="ffx-main">
        <div class="ffx-banner" role="status" hidden></div>
        <div class="ffx-editor"></div>
      </div>
    </div>
    <div class="ffx-drawer" hidden></div>
    <div class="ffx-foot"><span class="ffx-status"></span></div>`;
  shadow.append(style, app);

  const $ = <T extends HTMLElement>(sel: string): T => app.querySelector<T>(sel)!;
  const host = shadow.host as HTMLElement;

  // spike answer 3: bubble-phase stop at the host, every key type
  const stop = (e: Event): void => e.stopPropagation();
  for (const type of KEY_EVENTS) host.addEventListener(type, stop);

  const onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement).matches('input, textarea, select')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 'z') { e.preventDefault(); h.onUndo(); }
    else if (mod && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); h.onRedo(); }
  };
  app.addEventListener('keydown', onKey);

  let expanded = false;
  const setExpanded = (on: boolean): void => { expanded = on; app.classList.toggle('ffx-full', on); };
  $('.ffx-expand').addEventListener('click', () => setExpanded(!expanded));
  $('.ffx-close').addEventListener('click', () => h.onClose());
  const undoBtn = $<HTMLButtonElement>('.ffx-undo');
  const redoBtn = $<HTMLButtonElement>('.ffx-redo');
  undoBtn.addEventListener('click', () => h.onUndo());
  redoBtn.addEventListener('click', () => h.onRedo());
  const banner = $('.ffx-banner');

  return {
    app, title: $('.ffx-title'), tree: $('.ffx-tree'), editor: $('.ffx-editor'), banner,
    footer: $('.ffx-foot'), drawer: $('.ffx-drawer'), status: $('.ffx-status'), undoBtn, redoBtn,
    setExpanded,
    notice(text) { banner.textContent = text ?? ''; banner.hidden = !text; },
    destroy() {
      for (const type of KEY_EVENTS) host.removeEventListener(type, stop);
      app.removeEventListener('keydown', onKey);
      host.remove();
    },
  };
}
