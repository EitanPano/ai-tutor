type MdNode = { type: string; value?: string; children?: MdNode[] }

function visit(node: MdNode) {
  if (node.type === 'html') node.type = 'text'
  node.children?.forEach(visit)
}

/**
 * Remark plugin: raw HTML in a message becomes plain text, so `<img src=x onerror=...>` shows
 * up literally and no element is ever created. react-markdown already skips raw HTML unless
 * `rehype-raw` is added (never add it); this makes the HTML visible instead of dropping it.
 */
export function remarkNoRawHtml() {
  return (tree: MdNode) => visit(tree)
}
