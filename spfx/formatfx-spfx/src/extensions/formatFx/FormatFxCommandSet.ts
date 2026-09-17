/**
 * FormatFxCommandSet — the thin SPFx host for the FormatFX Format panel
 * (spec docs/superpowers/specs/2026-09-16-spfx-format-panel-design.md §4).
 * One command, "Format", mounts the panel as a shadow root on document.body.
 *
 * Spike facts this code answers to (spec §9):
 *  1. SharePoint creates TWO Command Set instances per page load and a modern
 *     view switch is client-side navigation with no SPFx event → the panel
 *     host is a singleton by element id, and the open view is re-keyed from
 *     the URL's `viewid` by a watcher, not from context.listView.
 *  3. The panel itself stops key propagation at its shadow host.
 * The panel's own view picks are full navigations; a per-tab record makes it
 * reopen on the new view (onInit).
 */
import { BaseListViewCommandSet, type IListViewCommandSetExecuteEventParameters } from '@microsoft/sp-listview-extensibility';
import {
  mountFormatPanel, PANEL_HOST_ID, viewIdFromUrl, watchUrl, readReopen, type PanelApi,
} from 'formatfx-panel';

export interface IFormatFxCommandSetProperties {}

export default class FormatFxCommandSet extends BaseListViewCommandSet<IFormatFxCommandSetProperties> {
  private panel: PanelApi | null = null;
  private stopWatch: (() => void) | null = null;

  public onInit(): Promise<void> {
    // reopen after the full navigation a view pick triggers (panel decision 3)
    const listId = this.listId();
    if (listId && readReopen(sessionStorage, listId)) this.open();
    return Promise.resolve();
  }

  public onExecute(event: IListViewCommandSetExecuteEventParameters): void {
    if (event.itemId === 'FORMAT') this.open();
  }

  protected onDispose(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    // the panel outlives this instance only if the other instance owns it;
    // ours closes with us
    if (this.panel) { void this.panel.close(); this.panel = null; }
    super.onDispose();
  }

  private open(): void {
    const listId = this.listId();
    if (!listId) return; // not a list page (e.g. an item form)
    if (document.getElementById(PANEL_HOST_ID)) return; // singleton — the other instance owns it
    const host = document.createElement('div');
    host.id = PANEL_HOST_ID;
    const shadow = host.attachShadow({ mode: 'open' });
    document.body.appendChild(host);
    this.panel = mountFormatPanel(shadow, {
      webUrl: this.context.pageContext.web.absoluteUrl,
      listId,
      listTitle: this.context.pageContext.list?.title,
      viewId: viewIdFromUrl(location.href),
      onClose: () => { this.stopWatch?.(); this.stopWatch = null; this.panel = null; },
    });
    this.stopWatch = watchUrl((href) => this.panel?.setViewId(viewIdFromUrl(href)));
  }

  private listId(): string | undefined {
    return this.context.pageContext.list?.id.toString();
  }
}
