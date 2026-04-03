// =============================================================================
// Node scaling — central dispatch, position, size
// =============================================================================

import { scale } from './utils';
import { isBoundToVariable, isDescendantOfInstance, hasScaleConstraint } from './guards';
import { scaleAutoLayout, scaleLayoutGrids, scaleGuides, scaleCssGrid } from './scale-layout';
import { scaleCornerRadius, scaleStrokes, scaleEffectsDirect } from './scale-appearance';
import { scaleTextProperties } from './scale-text';
import { scaleVectorNode } from './scale-vector';
import type { Anchor, OverrideMap } from './canvas-traversal';

export async function scaleNode(
  node: SceneNode,
  factor: number,
  overrideMap: OverrideMap,
  anchor: Anchor
): Promise<void> {
  console.log(`[scaleNode] ${node.name} (${node.type})`);

  const isInstanceOrInsideInstance =
    node.type === 'INSTANCE' || isDescendantOfInstance(node);
  const overriddenFields = overrideMap.get(node.id);

  function canWrite(field: string): boolean {
    if (isBoundToVariable(node, field)) return false;
    if (isInstanceOrInsideInstance) {
      return overriddenFields ? overriddenFields.has(field) : false;
    }
    if (hasScaleConstraint(node, field)) return false;
    return true;
  }

  if (node.type === 'GROUP') return;
  if (node.type === 'BOOLEAN_OPERATION') return;

  if (node.type === 'VECTOR') {
    scaleVectorNode(node, factor, canWrite, anchor);
    return;
  }

  if (node.type === 'SECTION') {
    scalePosition(node, factor, canWrite, anchor);
    const s = node as SectionNode;
    s.resizeWithoutConstraints(scale(s.width, factor), scale(s.height, factor));
    return;
  }

  scalePosition(node, factor, canWrite, anchor);
  scaleSize(node, factor, canWrite);
  scaleAutoLayout(node, factor, canWrite);
  scaleCornerRadius(node, factor, canWrite);
  scaleStrokes(node, factor, canWrite);
  scaleEffectsDirect(node, factor, canWrite);
  scaleLayoutGrids(node, factor, canWrite);
  scaleGuides(node, factor, canWrite);
  scaleCssGrid(node, factor, canWrite);
  await scaleTextProperties(node, factor, canWrite);
}

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------
function scalePosition(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean,
  anchor: Anchor
): void {
  if (!('x' in node && 'y' in node)) return;

  const parent = node.parent;
  const isAbsolute =
    'layoutPositioning' in node && (node as LayoutMixin).layoutPositioning === 'ABSOLUTE';
  const parentIsAutoLayout =
    parent !== null &&
    'layoutMode' in parent &&
    (parent as FrameNode).layoutMode !== 'NONE';

  const parentIsGroup = parent !== null && parent.type === 'GROUP';
  const groupParent = parentIsGroup ? parent!.parent : null;
  const groupParentLayoutMode =
    groupParent !== null && 'layoutMode' in groupParent
      ? (groupParent as FrameNode).layoutMode
      : 'NONE';
  const skipX = parentIsGroup && groupParentLayoutMode === 'HORIZONTAL';
  const skipY = parentIsGroup && groupParentLayoutMode === 'VERTICAL';

  const shouldScaleXY = !parentIsAutoLayout || isAbsolute;
  if (!shouldScaleXY) return;

  const isTopLevel = parent !== null && parent.type === 'PAGE';
  const nodeConstraints = 'constraints' in node
    ? (node as ConstraintMixin).constraints
    : null;

  if (!skipX && canWrite('x')) {
    const x = (node as any).x as number;
    if (!isTopLevel && nodeConstraints?.horizontal === 'MAX' && parent !== null && 'width' in parent) {
      const parentW = (parent as any).width as number;
      const parentFixedW =
        'layoutSizingHorizontal' in parent &&
        (parent as FrameNode).layoutSizingHorizontal === 'FIXED';
      const newParentW = parentFixedW ? scale(parentW, factor) : parentW;
      (node as any).x = parentW - newParentW + scale(x, factor);
    } else {
      (node as any).x = isTopLevel
        ? anchor.x + Math.round((x - anchor.x) * factor)
        : scale(x, factor);
    }
  }
  if (!skipY && canWrite('y')) {
    const y = (node as any).y as number;
    if (!isTopLevel && nodeConstraints?.vertical === 'MAX' && parent !== null && 'height' in parent) {
      const parentH = (parent as any).height as number;
      const parentFixedH =
        'layoutSizingVertical' in parent &&
        (parent as FrameNode).layoutSizingVertical === 'FIXED';
      const newParentH = parentFixedH ? scale(parentH, factor) : parentH;
      (node as any).y = parentH - newParentH + scale(y, factor);
    } else {
      (node as any).y = isTopLevel
        ? anchor.y + Math.round((y - anchor.y) * factor)
        : scale(y, factor);
    }
  }
}

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------
function scaleSize(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean
): void {
  if (!('layoutSizingHorizontal' in node)) return;
  const n = node as FrameNode;

  if (node.type === 'TEXT') {
    const t = node as TextNode;
    const autoResize = t.textAutoResize;

    if (autoResize === 'WIDTH_AND_HEIGHT') return;
    if (autoResize === 'HEIGHT') {
      if (n.layoutSizingHorizontal === 'FIXED' && canWrite('width')) {
        n.resize(scale(n.width, factor), n.height);
        t.textAutoResize = 'HEIGHT';
      }
      return;
    }
  }

  if (n.layoutSizingHorizontal === 'FIXED' && canWrite('width')) {
    n.resize(scale(n.width, factor), n.height);
  }
  if (n.layoutSizingVertical === 'FIXED' && canWrite('height')) {
    n.resize(n.width, scale(n.height, factor));
  }
}
