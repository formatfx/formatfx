import type { PanelCore } from './panel';
import type { TargetRef } from './journal';
export interface ApplyIo { read(t: TargetRef): Promise<string | null>; write(t: TargetRef, f: string | null): Promise<void> }
export interface ApplyUi { refresh(): void }
export function mountApply(_core: PanelCore, _io: ApplyIo): ApplyUi { return { refresh() {} }; }
