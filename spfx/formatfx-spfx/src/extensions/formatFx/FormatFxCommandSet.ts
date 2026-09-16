import { BaseListViewCommandSet, type IListViewCommandSetExecuteEventParameters } from '@microsoft/sp-listview-extensibility';
import { mountSpikePanel, type SpikeContext } from 'formatfx-panel';

export interface IFormatFxCommandSetProperties {}

const TAG = '[ffx-spike]';

export default class FormatFxCommandSet extends BaseListViewCommandSet<IFormatFxCommandSetProperties> {
  // Note: BaseComponent already exposes a public `get instanceId(): string`
  // (unique per component instance) -- reuse it rather than shadowing it
  // with our own field, which TS rejects (TS2415: can't narrow an
  // inherited public member to private). See FINDINGS.md "Task 3 notes".
  private panelHost: HTMLElement | undefined;

  public onInit(): Promise<void> {
    console.log(`${TAG} onInit instance=${this.instanceId} list=${this.listId()} view=${this.viewId()} url=${location.href}`);
    // Q1: fires on every ListView state change (selection, view switch, ...).
    this.context.listView.listViewStateChangedEvent.add(this, () => {
      console.log(`${TAG} listViewStateChanged instance=${this.instanceId} view=${this.viewId()} url=${location.href}`);
    });
    return Promise.resolve();
  }

  public onExecute(event: IListViewCommandSetExecuteEventParameters): void {
    if (event.itemId !== 'FORMAT') return;
    if (this.panelHost) { this.panelHost.remove(); }
    this.panelHost = document.createElement('div');
    this.panelHost.id = 'ffx-spike-host';
    const shadow = this.panelHost.attachShadow({ mode: 'open' });
    document.body.appendChild(this.panelHost);
    const ctx: SpikeContext = {
      webUrl: this.context.pageContext.web.absoluteUrl,
      listId: this.listId(),
      viewId: this.viewId(),
      instanceId: this.instanceId,
      log: (line) => console.log(`${TAG} ${line}`),
    };
    mountSpikePanel(shadow, ctx);
    console.log(`${TAG} panel mounted instance=${this.instanceId}`);
  }

  protected onDispose(): void {
    console.log(`${TAG} onDispose instance=${this.instanceId} panelStillInDom=${!!document.getElementById('ffx-spike-host')}`);
    super.onDispose();
  }

  private listId(): string {
    return this.context.pageContext.list?.id.toString() ?? '(none)';
  }
  private viewId(): string {
    return this.context.pageContext.listItem ? '(item)' : (this.context.listView.view?.id?.toString() ?? '(none)');
  }
}
