import { describe, it, expect, afterEach, vi } from 'vitest';
import { mountShell, type Shell } from './panelShell';

function mount(): { shell: Shell; host: HTMLElement; h: { onClose: ReturnType<typeof vi.fn>; onUndo: ReturnType<typeof vi.fn>; onRedo: ReturnType<typeof vi.fn>; onTheme: ReturnType<typeof vi.fn> } } {
  const host = document.createElement('div');
  host.id = 'ffx-format-panel';
  document.body.appendChild(host);
  const h = { onClose: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onTheme: vi.fn() };
  const shell = mountShell(host.attachShadow({ mode: 'open' }), ':host { --wb-bg: #fff; }', h);
  return { shell, host, h };
}
afterEach(() => { document.body.innerHTML = ''; });

describe('mountShell', () => {
  it('renders the chrome inside the shadow with the app css first', () => {
    const { shell, host } = mount();
    const styles = host.shadowRoot!.querySelectorAll('style');
    const text = styles[0].textContent!;
    expect(text).toContain(':host { all: initial; }');
    expect(text).toContain('--wb-bg: #fff');
    expect(text.split(':host { all: initial; }').length - 1).toBe(1);
    expect(text.indexOf(':host { all: initial; }')).toBeLessThan(text.indexOf('--wb-bg'));
    expect(shell.app.classList.contains('ffx-app')).toBe(true);
    expect(shell.picker.isConnected && shell.viewSelect.isConnected && shell.columnSelect.isConnected && shell.editor.isConnected && shell.footer.isConnected).toBe(true);
    expect(shell.drawer.hidden).toBe(true);
    expect(shell.banner.hidden).toBe(true);
  });

  it('lays the editor slot out like the web app\'s active tab and never restyles the pane\'s children', () => {
    // The JSON pane mounts ~9 siblings (toolbar, crumb row, shell, lint row,
    // hidden helpers) into the slot. A `.ffx-editor > *` rule stretched each
    // to an equal flex share — and its `display: flex` overrode `[hidden]` —
    // so the tenant showed a short editor under a tall crumb row and a bare
    // red import-error stripe (owner report 2026-09-17).
    const { host } = mount();
    const text = host.shadowRoot!.querySelector('style')!.textContent!;
    expect(text).not.toContain('.ffx-editor > *');
    const slot = /\.ffx-editor\s*\{([^}]*)\}/.exec(text)![1];
    // overflow: hidden, not auto — a scrolling slot let the browser nudge the
    // caret line to the bottom edge on every keystroke (owner smoke, round 5)
    for (const decl of ['flex: 1', 'min-height: 0', 'display: flex', 'flex-direction: column', 'overflow: hidden']) expect(slot).toContain(decl);
  });

  it('has no rail: the picker row holds a View and a Column select above the editor', () => {
    const { shell, host } = mount();
    expect(host.shadowRoot!.querySelector('.ffx-tree')).toBeNull();
    expect(shell.picker.querySelector('select.ffx-pick-view')).toBe(shell.viewSelect);
    expect(shell.picker.querySelector('select.ffx-pick-col')).toBe(shell.columnSelect);
    // the picker sits in the main column, before the banner and the editor
    const main = shell.picker.parentElement!;
    expect(main.classList.contains('ffx-main')).toBe(true);
    expect([...main.children].indexOf(shell.picker)).toBeLessThan([...main.children].indexOf(shell.editor));
  });

  it('has a theme button; setDark toggles wb-dark on the host and the button says where it goes', () => {
    const { shell, host, h } = mount();
    const btn = host.shadowRoot!.querySelector('.ffx-theme') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    shell.setDark(true);
    expect(host.classList.contains('wb-dark')).toBe(true);
    expect(btn.title).toContain('light'); // destination semantics, like the web app
    shell.setDark(false);
    expect(host.classList.contains('wb-dark')).toBe(false);
    expect(btn.title).toContain('dark');
    btn.click();
    expect(h.onTheme).toHaveBeenCalledTimes(1);
  });

  it('stops key events at the shadow host so SharePoint never sees them', () => {
    const { shell } = mount();
    const seen: string[] = [];
    const spy = (e: Event) => seen.push(e.type);
    document.addEventListener('keydown', spy);
    document.addEventListener('keyup', spy);
    document.addEventListener('keypress', spy);
    const ta = document.createElement('textarea');
    shell.editor.appendChild(ta);
    for (const type of ['keydown', 'keyup', 'keypress']) ta.dispatchEvent(new KeyboardEvent(type, { key: 'g', bubbles: true, composed: true }));
    document.removeEventListener('keydown', spy);
    document.removeEventListener('keyup', spy);
    document.removeEventListener('keypress', spy);
    expect(seen).toEqual([]);
  });

  it('routes Ctrl+Z / Ctrl+Y outside text fields to undo/redo', () => {
    const { shell, h } = mount();
    shell.picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, composed: true }));
    shell.picker.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, composed: true }));
    const ta = document.createElement('textarea');
    shell.editor.appendChild(ta);
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, composed: true }));
    expect(h.onUndo).toHaveBeenCalledTimes(1);
    expect(h.onRedo).toHaveBeenCalledTimes(1);
  });

  it('expands, notices, closes and destroys', () => {
    const { shell, host, h } = mount();
    shell.setExpanded(true);
    expect(shell.app.classList.contains('ffx-full')).toBe(true);
    shell.notice('Drafts live in this tab only');
    expect(shell.banner.hidden).toBe(false);
    expect(shell.banner.textContent).toContain('this tab only');
    shell.notice(null);
    expect(shell.banner.hidden).toBe(true);
    (host.shadowRoot!.querySelector('.ffx-close') as HTMLButtonElement).click();
    expect(h.onClose).toHaveBeenCalledTimes(1);
    shell.destroy();
    expect(document.getElementById('ffx-format-panel')).toBeNull();
  });
});
