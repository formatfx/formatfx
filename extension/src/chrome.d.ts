/**
 * Minimal ambient declarations for the slice of the MV3 extension API this
 * companion uses. Hand-written so the extension stays dependency-light (no
 * @types/chrome) and typechecks with the repo's own TypeScript. Widen as the
 * extension grows; this is deliberately not the full surface.
 */
declare namespace chrome {
  namespace tabs {
    interface Tab { id?: number; url?: string }
    function query(info: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
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
    function request(p: { origins?: string[] }): Promise<boolean>;
  }
  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    }
    const local: StorageArea;
  }
}
