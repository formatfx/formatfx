export interface SpikeContext {
  webUrl: string;
  listId: string;
  viewId: string;
  instanceId: string;
  log: (line: string) => void;
}
export function mountSpikePanel(host: ShadowRoot, ctx: SpikeContext): void;
