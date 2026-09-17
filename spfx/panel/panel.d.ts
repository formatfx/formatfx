export declare const PANEL_HOST_ID: string;
export declare const REOPEN_KEY: string;
export type TargetKind = 'Field' | 'View';
export interface TargetRef { kind: TargetKind; id: string }
export interface PanelContext {
  webUrl: string; listId: string; listTitle?: string; viewId: string | null;
  fetchImpl?: typeof fetch; storage?: Storage; navigate?: (url: string) => void; onClose?: () => void;
}
export interface PanelApi {
  ready: Promise<void>;
  setViewId(id: string | null): void;
  openTarget(t: TargetRef): Promise<void>;
  close(): Promise<void>;
}
export declare function mountFormatPanel(shadow: ShadowRoot, ctx: PanelContext): PanelApi;
export declare function viewIdFromUrl(href: string): string | null;
export declare function watchUrl(onChange: (href: string) => void, intervalMs?: number): () => void;
export interface ReopenState { listId: string; targetKey: string | null }
export declare function readReopen(storage: Storage, listId: string): ReopenState | null;
