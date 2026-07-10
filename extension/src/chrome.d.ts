/**
 * Minimal ambient declarations for the slice of the MV3 extension API this
 * companion uses. Hand-written so the extension stays dependency-light (no
 * @types/chrome) and typechecks with the repo's own TypeScript. Widen as the
 * extension grows; this is deliberately not the full surface.
 */
declare namespace chrome {
  namespace tabs {
    interface Tab { id?: number; url?: string; active?: boolean; windowId?: number }
    interface TabChangeInfo { url?: string; status?: string }
    function query(info: { active?: boolean; currentWindow?: boolean; url?: string | string[] }): Promise<Tab[]>;
    function create(props: { url: string; active?: boolean }): Promise<Tab>;
    function get(tabId: number): Promise<Tab>;
    function sendMessage<R = unknown>(tabId: number, message: unknown): Promise<R>;
    const onUpdated: {
      addListener(cb: (tabId: number, changeInfo: TabChangeInfo, tab: Tab) => void): void;
    };
    const onActivated: {
      addListener(cb: (info: { tabId: number; windowId: number }) => void): void;
    };
    const onRemoved: {
      addListener(cb: (tabId: number, info: { windowId: number; isWindowClosing: boolean }) => void): void;
    };
  }
  namespace runtime {
    interface MessageSender { tab?: tabs.Tab; id?: string }
    const onMessage: {
      addListener(
        cb: (message: unknown, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | undefined | void,
      ): void;
    };
    const onInstalled: {
      addListener(cb: (details: { reason: string }) => void): void;
    };
    function sendMessage<R = unknown>(message: unknown): Promise<R>;
    const lastError: { message?: string } | undefined;
  }
  namespace action {
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void>;
    function setTitle(details: { title: string; tabId?: number }): Promise<void>;
  }
  namespace scripting {
    interface InjectionTarget { tabId: number }
    interface ScriptInjection<Args extends unknown[], R> {
      target: InjectionTarget;
      world?: 'MAIN' | 'ISOLATED';
      files?: string[];
      func?: (...args: Args) => R;
      args?: Args;
    }
    interface InjectionResult<R> { result: R }
    function executeScript<Args extends unknown[], R>(
      injection: ScriptInjection<Args, R>,
    ): Promise<InjectionResult<R>[]>;
  }
  namespace permissions {
    interface Permissions { origins?: string[]; permissions?: string[] }
    function request(p: Permissions): Promise<boolean>;
    function contains(p: Permissions): Promise<boolean>;
    function remove(p: Permissions): Promise<boolean>;
    function getAll(): Promise<Permissions>;
    const onAdded: { addListener(cb: (p: Permissions) => void): void };
    const onRemoved: { addListener(cb: (p: Permissions) => void): void };
  }
  namespace storage {
    interface StorageChange { oldValue?: unknown; newValue?: unknown }
    interface StorageArea {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const local: StorageArea;
    const onChanged: {
      addListener(cb: (changes: Record<string, StorageChange>, areaName: string) => void): void;
    };
  }
}
