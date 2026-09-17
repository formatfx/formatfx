/**
 * urlState.ts — spike answer 1 made concrete: a modern view switch is
 * client-side navigation that fires no SPFx event and leaves
 * context.listView.view one switch behind, so the panel keys its open view
 * off the URL's `viewid`. The watcher is a 500 ms poll plus popstate; a
 * reopen record in sessionStorage survives the full navigation the panel
 * itself triggers when the person picks another view (§2.4).
 */
import { normalizeGuid } from './targetIo';

export function viewIdFromUrl(href: string): string | null {
  try {
    const v = new URL(href, 'https://placeholder.invalid').searchParams.get('viewid');
    return v ? normalizeGuid(v) : null;
  } catch {
    return null;
  }
}

export function watchUrl(onChange: (href: string) => void, intervalMs = 500): () => void {
  let last = location.href;
  const check = (): void => {
    if (location.href !== last) { last = location.href; onChange(last); }
  };
  const timer = setInterval(check, intervalMs);
  window.addEventListener('popstate', check);
  return () => { clearInterval(timer); window.removeEventListener('popstate', check); };
}

export const REOPEN_KEY = 'ffx-panel.reopen';
export interface ReopenState { listId: string; targetKey: string | null }

export function readReopen(storage: Storage, listId: string): ReopenState | null {
  try {
    const raw = storage.getItem(REOPEN_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ReopenState;
    return s.listId === listId ? s : null;
  } catch {
    return null;
  }
}

export function writeReopen(storage: Storage, s: ReopenState | null): void {
  try {
    if (s) storage.setItem(REOPEN_KEY, JSON.stringify(s));
    else storage.removeItem(REOPEN_KEY);
  } catch { /* private mode */ }
}
