// =============================================================================
// Step 4 — Canvas (bottom-up traversal, all pages or selection)
// =============================================================================

import { sendProgress, yieldControl } from './utils';
import { scaleNode } from './scale-node';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Anchor { x: number; y: number; }
export type OverrideMap = Map<string, Set<string>>; // nodeId → Set<overriddenField>

// ---------------------------------------------------------------------------
// Step 4 — All pages
// ---------------------------------------------------------------------------
export async function runStep4(
  factor: number,
  onPageProgress: (index: number, total: number, name: string) => void
): Promise<{ nodes: number; pages: number }> {
  let totalNodes = 0;
  const pages = figma.root.children;
  const pageCount = pages.length;

  for (let i = 0; i < pageCount; i++) {
    const page = pages[i];
    onPageProgress(i + 1, pageCount, page.name);
    await yieldControl();

    const overrideMap = buildOverrideMap(page);
    const anchor = getPageAnchor(page);
    const count = await traverseBottomUp(page, factor, overrideMap, anchor);
    totalNodes += count;

    await yieldControl();
  }

  return { nodes: totalNodes, pages: pageCount };
}

// ---------------------------------------------------------------------------
// Step 4 — Selection only
// ---------------------------------------------------------------------------
export async function runStep4Selection(factor: number): Promise<{ nodes: number; pages: number }> {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    throw new Error('Keine Nodes ausgewählt.');
  }

  sendProgress(`Schritt 4 — Canvas — Auswahl (${selection.length} Nodes)…`);
  await yieldControl();

  const overrideMap = buildOverrideMap(figma.currentPage);
  const anchor = getPageAnchor(figma.currentPage);
  let totalNodes = 0;

  for (const node of selection) {
    totalNodes += await traverseBottomUp(node, factor, overrideMap, anchor);
  }

  return { nodes: totalNodes, pages: 1 };
}

// ---------------------------------------------------------------------------
// Bottom-up traversal
// ---------------------------------------------------------------------------
async function traverseBottomUp(
  node: BaseNode,
  factor: number,
  overrideMap: OverrideMap,
  anchor: Anchor
): Promise<number> {
  let count = 0;

  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) {
      try {
        count += await traverseBottomUp(child, factor, overrideMap, anchor);
      } catch (err) {
        console.error(`[traverseBottomUp] skipped "${(child as any).name}" (${(child as any).type}):`, err);
      }
    }
  }

  if (node.type === 'PAGE' || node.type === 'DOCUMENT') return count;

  await scaleNode(node as SceneNode, factor, overrideMap, anchor);
  count++;

  return count;
}

// ---------------------------------------------------------------------------
// Override map
// ---------------------------------------------------------------------------
function buildOverrideMap(root: BaseNode): OverrideMap {
  const map: OverrideMap = new Map();
  collectOverrides(root, map);
  return map;
}

function collectOverrides(node: BaseNode, map: OverrideMap): void {
  if (node.type === 'INSTANCE') {
    for (const override of node.overrides) {
      if (!map.has(override.id)) {
        map.set(override.id, new Set());
      }
      for (const field of override.overriddenFields) {
        map.get(override.id)!.add(field);
      }
    }
  }
  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) {
      collectOverrides(child, map);
    }
  }
}

// ---------------------------------------------------------------------------
// Anchor — top-left of page bounding box
// ---------------------------------------------------------------------------
function getPageAnchor(page: PageNode): Anchor {
  const children = page.children;
  if (children.length === 0) return { x: 0, y: 0 };
  let minX = Infinity;
  let minY = Infinity;
  for (const child of children) {
    if ('x' in child && 'y' in child) {
      minX = Math.min(minX, (child as any).x);
      minY = Math.min(minY, (child as any).y);
    }
  }
  return {
    x: minX === Infinity ? 0 : minX,
    y: minY === Infinity ? 0 : minY,
  };
}
