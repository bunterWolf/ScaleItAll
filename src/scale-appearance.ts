// =============================================================================
// Appearance scaling — corner radius, strokes, effects (direct on node)
// =============================================================================

import { scale, scaleExact } from './utils';
import { isBoundToStyle } from './guards';
import { scaleEffect } from './scale-effect-paint-styles';

export function scaleCornerRadius(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean
): void {
  if (!('cornerRadius' in node)) return;
  const n = node as RectangleNode;

  if (n.cornerRadius !== figma.mixed) {
    if (canWrite('cornerRadius')) n.cornerRadius = scale(n.cornerRadius as number, factor);
  } else {
    if (canWrite('topLeftRadius'))     n.topLeftRadius     = scale(n.topLeftRadius,     factor);
    if (canWrite('topRightRadius'))    n.topRightRadius    = scale(n.topRightRadius,    factor);
    if (canWrite('bottomLeftRadius'))  n.bottomLeftRadius  = scale(n.bottomLeftRadius,  factor);
    if (canWrite('bottomRightRadius')) n.bottomRightRadius = scale(n.bottomRightRadius, factor);
  }
}

export function scaleStrokes(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean
): void {
  if (!('strokeWeight' in node)) return;
  const n = node as GeometryMixin & SceneNode;

  if (n.strokeWeight !== figma.mixed) {
    if (canWrite('strokeWeight')) (n as any).strokeWeight = scaleExact(n.strokeWeight as number, factor);
  } else {
    const in_ = n as IndividualStrokesMixin & SceneNode;
    if (canWrite('strokeTopWeight'))    in_.strokeTopWeight    = scaleExact(in_.strokeTopWeight,    factor);
    if (canWrite('strokeBottomWeight')) in_.strokeBottomWeight = scaleExact(in_.strokeBottomWeight, factor);
    if (canWrite('strokeLeftWeight'))   in_.strokeLeftWeight   = scaleExact(in_.strokeLeftWeight,   factor);
    if (canWrite('strokeRightWeight'))  in_.strokeRightWeight  = scaleExact(in_.strokeRightWeight,  factor);
  }

  if ('dashPattern' in n && canWrite('dashPattern')) {
    (n as any).dashPattern = (n as GeometryMixin).dashPattern.map(v => scaleExact(v, factor));
  }
}

export function scaleEffectsDirect(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean
): void {
  if (!('effects' in node)) return;
  if (!canWrite('effects')) return;
  if (isBoundToStyle(node, 'effects')) return;

  const n = node as BlendMixin & SceneNode;
  n.effects = n.effects.map(e => scaleEffect(e, factor));
}
