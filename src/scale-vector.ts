// =============================================================================
// VECTOR node scaling (no integer rounding)
// =============================================================================

import { scaleExact } from './utils';
import { scaleStrokes } from './scale-appearance';
import type { Anchor } from './canvas-traversal';

export function scaleVectorNode(
  node: VectorNode,
  factor: number,
  canWrite: (field: string) => boolean,
  anchor: Anchor
): void {
  const parent = node.parent;
  const isTopLevel = parent !== null && parent.type === 'PAGE';

  const isAbsolute =
    'layoutPositioning' in node &&
    (node as any).layoutPositioning === 'ABSOLUTE';
  const parentIsAutoLayout =
    parent !== null &&
    'layoutMode' in parent &&
    (parent as FrameNode).layoutMode !== 'NONE';
  const shouldScaleXY = !parentIsAutoLayout || isAbsolute;

  const constraints = 'constraints' in node
    ? (node as ConstraintMixin).constraints
    : null;
  const hC = constraints?.horizontal ?? 'MIN';
  const vC = constraints?.vertical   ?? 'MIN';

  // ── SCALE-involved axes ───────────────────────────────────────────────────
  if (hC === 'SCALE' || vC === 'SCALE') {
    const oldX = node.x;
    const oldY = node.y;
    const oldW = node.width;
    const oldH = node.height;
    const MIN_DIM = 0.01;
    const newW = Math.max(MIN_DIM, scaleExact(oldW, factor));
    const newH = Math.max(MIN_DIM, scaleExact(oldH, factor));

    node.resize(newW, newH);

    (node as ConstraintMixin).constraints = {
      horizontal: hC === 'SCALE' ? 'MIN' : hC,
      vertical:   vC === 'SCALE' ? 'MIN' : vC,
    };

    if (shouldScaleXY) {
      if ((hC === 'SCALE' || hC === 'MIN') && canWrite('x')) {
        (node as any).x = isTopLevel
          ? anchor.x + (oldX - anchor.x) * factor
          : scaleExact(oldX, factor);
      }
      if ((vC === 'SCALE' || vC === 'MIN') && canWrite('y')) {
        (node as any).y = isTopLevel
          ? anchor.y + (oldY - anchor.y) * factor
          : scaleExact(oldY, factor);
      }
      if (hC === 'CENTER' && canWrite('x')) {
        (node as any).x = oldX + (oldW - newW) / 2;
      }
      if (vC === 'CENTER' && canWrite('y')) {
        (node as any).y = oldY + (oldH - newH) / 2;
      }
    }

    scaleStrokes(node, factor, canWrite);
    return;
  }

  // ── No SCALE constraint — handle manually ─────────────────────────────────
  if (shouldScaleXY) {
    if ((hC === 'MIN' || hC === 'CENTER') && canWrite('x')) {
      (node as any).x = isTopLevel
        ? anchor.x + (node.x - anchor.x) * factor
        : scaleExact(node.x, factor);
    }
    if ((vC === 'MIN' || vC === 'CENTER') && canWrite('y')) {
      (node as any).y = isTopLevel
        ? anchor.y + (node.y - anchor.y) * factor
        : scaleExact(node.y, factor);
    }
  }

  if (hC === 'CENTER' || vC === 'CENTER') {
    (node as ConstraintMixin).constraints = {
      horizontal: hC === 'CENTER' ? 'MIN' : hC,
      vertical:   vC === 'CENTER' ? 'MIN' : vC,
    };
  }

  const hManual = hC !== 'STRETCH' && canWrite('width');
  const vManual = vC !== 'STRETCH' && canWrite('height');

  if (hManual || vManual) {
    const oldW = node.width;
    const oldH = node.height;
    const MIN_DIM = 0.01;
    const newW = hManual ? Math.max(MIN_DIM, scaleExact(oldW, factor)) : oldW;
    const newH = vManual ? Math.max(MIN_DIM, scaleExact(oldH, factor)) : oldH;
    node.resize(newW, newH);
  }

  scaleStrokes(node, factor, canWrite);
}
