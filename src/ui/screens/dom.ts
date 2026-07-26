/**
 * The three DOM primitives every screen needs (docs/areas/10-hud-ui.md §3.1c).
 *
 * Screens are hand-written DOM, not a template language: there is no framework in
 * this project and adding one to render six mostly-static panels would be a poor
 * trade. These helpers exist so that intent stays readable and so that **text is
 * only ever set through `textContent`** — no screen anywhere assembles markup from
 * a string, which is what keeps player-supplied names (highscores) inert.
 */

type Attrs = Record<string, string | number | boolean | undefined>;

/**
 * Create an element with attributes and children. A string child becomes a text
 * node; `undefined`/`false` attributes are omitted, so optional attributes read as
 * `{ disabled: someFlag }` rather than a conditional spread.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** An emoji span carrying the cross-platform font stack (docs/compatibility.md §2). */
export function icon(glyph: string, label: string): HTMLSpanElement {
  return el('span', { class: 'icon', role: 'img', 'aria-label': label, text: glyph });
}

/**
 * Set `textContent` only when it actually differs.
 *
 * Screens are updated every frame from `render(alpha)`, and writing `textContent`
 * unconditionally would dirty layout sixty times a second for text that changes
 * once a run. This is the one optimisation the UI layer needs.
 */
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Toggle an attribute-flag the same way, again only on change. */
export function setFlag(node: HTMLElement, attr: string, on: boolean): void {
  const has = node.hasAttribute(attr);
  if (on === has) return;
  if (on) node.setAttribute(attr, '');
  else node.removeAttribute(attr);
}
