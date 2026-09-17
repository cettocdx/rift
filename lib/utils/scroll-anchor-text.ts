/** Read only the text needed to identify a retained scroll anchor. */
export function scrollAnchorText(node: Element): string {
  if (node.tagName === "IMG")
    return (node.getAttribute("src") ?? "").trim().slice(0, 80);
  const walker = node.ownerDocument.createTreeWalker(
    node,
    NodeFilter.SHOW_TEXT,
  );
  let prefix = "";
  let next: Node | null;
  while (prefix.length < 80 && (next = walker.nextNode())) {
    const text = next.nodeValue ?? "";
    const remaining = prefix ? text : text.trimStart();
    prefix += remaining.slice(0, 80 - prefix.length);
  }
  return prefix.trimEnd();
}
