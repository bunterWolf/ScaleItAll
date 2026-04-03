// =============================================================================
// Layout scaling — AutoLayout, CSS Grid, layout grids, guides
// =============================================================================

import { scale } from './utils';

export function scaleAutoLayout(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean
): void {
  if (!('layoutMode' in node)) return;
  const n = node as FrameNode;
  if (n.layoutMode === 'NONE') return;

  if (canWrite('paddingTop'))    n.paddingTop    = scale(n.paddingTop,    factor);
  if (canWrite('paddingBottom')) n.paddingBottom = scale(n.paddingBottom, factor);
  if (canWrite('paddingLeft'))   n.paddingLeft   = scale(n.paddingLeft,   factor);
  if (canWrite('paddingRight'))  n.paddingRight  = scale(n.paddingRight,  factor);
  if (canWrite('itemSpacing'))   n.itemSpacing   = scale(n.itemSpacing,   factor);

  if (n.layoutWrap === 'WRAP' && canWrite('counterAxisSpacing')) {
    const cas = n.counterAxisSpacing;
    if (typeof cas === 'number') {
      n.counterAxisSpacing = scale(cas, factor);
    }
  }
  if (n.minWidth  !== null && canWrite('minWidth'))  n.minWidth  = scale(n.minWidth,  factor);
  if (n.minHeight !== null && canWrite('minHeight')) n.minHeight = scale(n.minHeight, factor);
  if (n.maxWidth  !== null && canWrite('maxWidth'))  n.maxWidth  = scale(n.maxWidth,  factor);
  if (n.maxHeight !== null && canWrite('maxHeight')) n.maxHeight = scale(n.maxHeight, factor);
}

export function scaleLayoutGrids(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean
): void {
  if (
    node.type !== 'FRAME' &&
    node.type !== 'COMPONENT' &&
    node.type !== 'COMPONENT_SET'
  ) return;
  if (!canWrite('layoutGrids')) return;

  const n = node as FrameNode;
  n.layoutGrids = n.layoutGrids.map(grid => {
    if (grid.pattern === 'ROWS' || grid.pattern === 'COLUMNS') {
      return {
        ...grid,
        gutterSize: scale(grid.gutterSize, factor),
        sectionSize: grid.sectionSize != null ? scale(grid.sectionSize, factor) : grid.sectionSize,
        offset: grid.offset != null ? scale(grid.offset, factor) : grid.offset,
      };
    } else if (grid.pattern === 'GRID') {
      return { ...grid, sectionSize: scale(grid.sectionSize, factor) };
    }
    return grid;
  });
}

export function scaleGuides(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean
): void {
  if (node.type !== 'FRAME') return;
  if (!canWrite('guides')) return;
  const n = node as FrameNode;
  n.guides = n.guides.map(g => ({ ...g, offset: scale(g.offset, factor) }));
}

export function scaleCssGrid(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean
): void {
  if (!('layoutMode' in node)) return;
  const n = node as any;
  if (n.layoutMode !== 'GRID') return;

  if (canWrite('gridRowGap'))    n.gridRowGap    = scale(n.gridRowGap,    factor);
  if (canWrite('gridColumnGap')) n.gridColumnGap = scale(n.gridColumnGap, factor);

  if (canWrite('gridRowSizes') && Array.isArray(n.gridRowSizes)) {
    n.gridRowSizes = n.gridRowSizes.map((entry: any) =>
      entry.type === 'FIXED' ? { ...entry, value: scale(entry.value, factor) } : entry
    );
  }
  if (canWrite('gridColumnSizes') && Array.isArray(n.gridColumnSizes)) {
    n.gridColumnSizes = n.gridColumnSizes.map((entry: any) =>
      entry.type === 'FIXED' ? { ...entry, value: scale(entry.value, factor) } : entry
    );
  }
}
