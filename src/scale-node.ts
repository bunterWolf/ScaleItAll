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

  let wroteCenterX = false;
  let wroteCenterY = false;

  if (!skipX && canWrite('x')) {
    const x = (node as any).x as number;
    if (!isTopLevel && nodeConstraints?.horizontal === 'MAX' && parent !== null && 'width' in parent) {
      const parentW = (parent as any).width as number;
      const parentFixedW =
        'layoutSizingHorizontal' in parent &&
        (parent as FrameNode).layoutSizingHorizontal === 'FIXED';
      const newParentW = parentFixedW ? scale(parentW, factor) : parentW;
      // WIDTH_AND_HEIGHT text: changing fontSize causes Figma to auto-pin the right edge,
      // which shifts x. We pre-compensate so the final rightDist = scale(originalRightDist).
      const isWAH =
        node.type === 'TEXT' &&
        (node as TextNode).textAutoResize === 'WIDTH_AND_HEIGHT' &&
        'width' in node;
      if (isWAH) {
        const nodeW = (node as any).width as number;
        const rightDist = parentW - x - nodeW;
        (node as any).x = parentW - nodeW - scale(rightDist, factor);
      } else {
        (node as any).x = parentW - newParentW + scale(x, factor);
      }
    } else if (!isTopLevel && nodeConstraints?.horizontal === 'CENTER' && parent !== null && 'width' in parent) {
      // CENTER constraint: Figma stores a constant offset from parent center.
      // Problem: bottom-up traversal processes children first. If this node is HUG,
      // child text-scaling triggers an auto-resize, which causes Figma to fire the
      // CENTER constraint immediately — repositioning this node before we read x.
      // So current x is already distorted. However, the stored CENTER offset
      // (node_center − parent_center) is preserved through HUG resize, so we can
      // recover it and compute the correct target position.
      const parentW = (parent as any).width as number;
      const nodeW   = (node as any).width as number;
      const centerOffset = (x + nodeW / 2) - parentW / 2;
      const parentFixedW =
        'layoutSizingHorizontal' in parent &&
        (parent as FrameNode).layoutSizingHorizontal === 'FIXED';
      const newParentW = parentFixedW ? scale(parentW, factor) : parentW;
      // For HUG nodes the width is already at its final value (set by child resize).
      // For FIXED nodes scaleSize will scale the width afterwards, so pre-compute it.
      const isNodeHugW =
        'layoutSizingHorizontal' in node &&
        (node as FrameNode).layoutSizingHorizontal === 'HUG';
      const newNodeW = isNodeHugW ? nodeW : scale(nodeW, factor);
      (node as any).x = newParentW / 2 + centerOffset - newNodeW / 2;
      wroteCenterX = true;
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
      // Same logic for vertical: WIDTH_AND_HEIGHT text auto-pins the bottom edge on font resize.
      const isWAH =
        node.type === 'TEXT' &&
        (node as TextNode).textAutoResize === 'WIDTH_AND_HEIGHT' &&
        'height' in node;
      if (isWAH) {
        const nodeH = (node as any).height as number;
        const bottomDist = parentH - y - nodeH;
        (node as any).y = parentH - nodeH - scale(bottomDist, factor);
      } else {
        (node as any).y = parentH - newParentH + scale(y, factor);
      }
    } else if (!isTopLevel && nodeConstraints?.vertical === 'CENTER' && parent !== null && 'height' in parent) {
      // Same CENTER logic as horizontal — see comment above.
      const parentH = (parent as any).height as number;
      const nodeH   = (node as any).height as number;
      const centerOffset = (y + nodeH / 2) - parentH / 2;
      const parentFixedH =
        'layoutSizingVertical' in parent &&
        (parent as FrameNode).layoutSizingVertical === 'FIXED';
      const newParentH = parentFixedH ? scale(parentH, factor) : parentH;
      const isNodeHugH =
        'layoutSizingVertical' in node &&
        (node as FrameNode).layoutSizingVertical === 'HUG';
      const newNodeH = isNodeHugH ? nodeH : scale(nodeH, factor);
      (node as any).y = newParentH / 2 + centerOffset - newNodeH / 2;
      wroteCenterY = true;
    } else {
      (node as any).y = isTopLevel
        ? anchor.y + Math.round((y - anchor.y) * factor)
        : scale(y, factor);
    }
  }

  // Demote CENTER → MIN on axes where we manually set the position, so that
  // a subsequent parent resize does not override our value via Figma's
  // CENTER constraint. Only demote axes we actually wrote.
  if (!isTopLevel && nodeConstraints !== null && (wroteCenterX || wroteCenterY)) {
    const hC = nodeConstraints.horizontal;
    const vC = nodeConstraints.vertical;
    if (wroteCenterX || wroteCenterY) {
      (node as ConstraintMixin).constraints = {
        horizontal: (wroteCenterX && hC === 'CENTER') ? 'MIN' : hC,
        vertical:   (wroteCenterY && vC === 'CENTER') ? 'MIN' : vC,
      };
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
