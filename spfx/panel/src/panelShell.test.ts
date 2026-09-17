import { describe, it, expect, afterEach, vi } from 'vitest';
import { mountShell, type Shell } from './panelShell';

function mount(): { shell: Shell; host: HTMLElement; h: { onClose: ReturnType<typeof vi.fn>; onUndo: ReturnType<typeof vi.fn>; onRedo: ReturnType<typeof vi.fn> } } {
  const host = document.createElement('div');
  host.id = 'ffx-format-panel';
  document.body.appendChild(host);
  const h = { onClose: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn() };
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
    expect(shell.tree.isConnected && shell.editor.isConnected && shell.footer.isConnected).toBe(true);
    expect(shell.drawer.hidden).toBe(true);
    expect(shell.banner.hidden).toBe(true);
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
    shell.tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, composed: true }));
    shell.tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, composed: true }));
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
