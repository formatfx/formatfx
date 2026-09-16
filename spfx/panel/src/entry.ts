// Spike panel: proves the real engine runs inside a shadow root on a
// SharePoint page. Read-only against the tenant. Throwaway.
import { importJson } from '../../../src/core/serializer';
import { renderElement } from '../../../src/core/renderer';
import { buildThemeCss } from '../../../src/core/theme';
import { excelToSp } from '../../../src/editor/dialect';
import { readPageContext } from '../../../src/bridge/spClient';
import type { EvalContext } from '../../../src/core/expressions';

export interface SpikeContext {
  webUrl: string;
  listId: string;
  viewId: string;
  instanceId: string;
  log: (line: string) => void;
}

const SAMPLE = JSON.stringify({
  elmType: 'div',
  style: { padding: '4px 8px', 'border-radius': '12px', 'background-color': '#e8f5e9' },
  txtContent: "='Status: ' + @currentField",
});

export function mountSpikePanel(host: ShadowRoot, ctx: SpikeContext): void {
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .wrap { position: fixed; top: 0; right: 0; width: 480px; height: 100vh;
            background: #fff; color: #222; border-left: 1px solid #ccc;
            font: 13px system-ui, sans-serif; padding: 12px; box-sizing: border-box;
            z-index: 1000000; display: flex; flex-direction: column; gap: 8px; }
    textarea { width: 100%; height: 120px; font: 12px monospace; }
    .log { flex: 1; overflow: auto; font: 11px monospace; white-space: pre-wrap;
           background: #f6f6f6; padding: 6px; }
    button { padding: 4px 10px; }
    ${buildThemeCss('light')}
  `;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <strong>FormatFX spike — instance ${ctx.instanceId}</strong>
    <div>list ${ctx.listId} · view ${ctx.viewId}</div>
    <textarea id="json"></textarea>
    <label><input type="checkbox" id="guard"> stop keydown propagation at host (round-2 probe)</label>
    <div>
      <button id="render">Render</button>
      <button id="reset">Reset sample</button>
      <button id="fields">Fetch fields (GET)</button>
      <button id="close">Close</button>
    </div>
    <div id="preview"></div>
    <div class="log" id="log"></div>
  `;
  host.append(style, wrap);

  // Round-2 probe: does stopping propagation at the shadow host keep SharePoint's
  // page-level handler from cancelling keys like plain "g"? Toggle via the checkbox.
  let guard = false;
  host.host.addEventListener('keydown', (e) => { if (guard) e.stopPropagation(); }, true);

  const $ = <T extends HTMLElement>(id: string) => wrap.querySelector<T>('#' + id)!;
  const logBox = $('log');
  const log = (line: string) => {
    ctx.log(line);
    logBox.textContent += line + '\n';
  };
  $<HTMLTextAreaElement>('json').value = SAMPLE;

  $<HTMLInputElement>('guard').addEventListener('change', (e) => { guard = (e.target as HTMLInputElement).checked; log('guard=' + guard); });

  // Q3 instrumentation: does SharePoint swallow keys inside the shadow panel?
  // The flag is read in a macrotask AFTER dispatch completes, so a page-level
  // (document/window) handler that calls preventDefault() later in the bubble
  // is still observed. Reading it synchronously at the target would miss that.
  const ta = $<HTMLTextAreaElement>('json');
  for (const type of ['keydown', 'keyup', 'input', 'paste'] as const) {
    ta.addEventListener(type, (e) => {
      const k = (e as KeyboardEvent).key ?? '';
      setTimeout(() => log(`${type} ${k} defaultPrevented=${e.defaultPrevented} guard=${guard}`), 0);
    });
  }

  $('render').addEventListener('click', () => {
    try {
      // Q2: prove an editor module is in the bundle and runs.
      const t = excelToSp('=1+1');
      log('excelToSp OK: ' + JSON.stringify(t).slice(0, 80));
      const doc = importJson(ta.value);
      const evalCtx: EvalContext = {
        row: { Status: 'Done', Title: 'Spike row' },
        rowIndex: 0,
        currentFieldName: 'Status',
        me: { title: 'Spike User', email: 'spike@example.com' } as EvalContext['me'],
        iterators: {}, iteratorIndex: {}, displayNames: {}, now: new Date(),
      };
      const out = renderElement(doc.root, evalCtx, {});
      $('preview').replaceChildren(out);
      log('render OK');
    } catch (err) {
      log('render FAILED: ' + (err as Error).message);
    }
  });

  $('reset').addEventListener('click', () => {
    ta.value = SAMPLE;
    log('sample reset');
  });

  $('fields').addEventListener('click', async () => {
    const pc = readPageContext();
    log('_spPageContextInfo present: ' + (pc !== null));
    const url = `${ctx.webUrl}/_api/web/lists(guid'${ctx.listId}')/fields?$select=InternalName,TypeAsString,CustomFormatter&$filter=Hidden eq false`;
    const res = await fetch(url, { headers: { Accept: 'application/json;odata=nometadata' } });
    log(`GET fields → ${res.status}`);
    if (res.ok) {
      const body = await res.json() as { value: { InternalName: string; TypeAsString: string; CustomFormatter?: string }[] };
      for (const f of body.value) log(`  ${f.InternalName} (${f.TypeAsString})${f.CustomFormatter ? ' [formatted]' : ''}`);
    }
    // Q4: does a single field / view entity carry an ETag? Both GETs, read-only.
    const single = [
      `${ctx.webUrl}/_api/web/lists(guid'${ctx.listId}')/fields/getbyinternalnameortitle('Title')`,
      `${ctx.webUrl}/_api/web/lists(guid'${ctx.listId}')/views?$top=1`,
    ];
    for (const u of single) {
      const r = await fetch(u, { headers: { Accept: 'application/json;odata=minimalmetadata' } });
      const hdr = r.headers.get('ETag');
      const j = r.ok ? await r.json() as Record<string, unknown> : {};
      const first = Array.isArray(j['value']) ? (j['value'] as Record<string, unknown>[])[0] ?? {} : j;
      // Both spellings: older payloads use "odata.etag", current minimal-metadata uses "@odata.etag".
      const bodyEtag = first['@odata.etag'] ?? first['odata.etag'] ?? 'none';
      log(`GET ${u.includes('/views') ? 'view' : 'field'} → ${r.status} ETag-header=${hdr ?? 'none'} body-etag=${String(bodyEtag)}`);
    }
  });

  $('close').addEventListener('click', () => host.host.remove());
}
