/** The completion popup must live in the SAME root as its editor: inside a
 *  shadow root (the SPFx panel) a body-mounted popup would be unstyled and
 *  outside the key guard. In the document it stays on body as before. */
import { describe, it, expect, afterEach } from 'vitest';
import { openAcMenu } from './acMenu';

afterEach(() => { document.body.innerHTML = ''; });

describe('openAcMenu root', () => {
  it('mounts on document.body for a light-DOM editor', () => {
    const editor = document.createElement('div');
    document.body.appendChild(editor);
    const menu = openAcMenu(editor, [{ insert: 'a' }], () => {});
    expect(menu.el.parentNode).toBe(document.body);
    menu.close();
  });
  it('mounts inside the shadow root for a shadow-DOM editor', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const editor = document.createElement('div');
    shadow.appendChild(editor);
    const menu = openAcMenu(editor, [{ insert: 'a' }], () => {});
    expect(menu.el.parentNode).toBe(shadow);
    menu.close();
  });
});
