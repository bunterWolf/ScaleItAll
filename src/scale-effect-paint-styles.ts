// =============================================================================
// Step 3 — Effect Styles & Paint Styles
// =============================================================================

import { scale, scaleExact } from './utils';

export async function runStep3(factor: number): Promise<void> {
  const effectStyles = await figma.getLocalEffectStylesAsync();
  for (const style of effectStyles) {
    style.effects = style.effects.map(effect => scaleEffect(effect, factor));
  }

  const paintStyles = await figma.getLocalPaintStylesAsync();
  for (const style of paintStyles) {
    style.paints = style.paints.map(paint => scaleGradientTransform(paint, factor));
  }
}

export function scaleEffect(effect: Effect, factor: number): Effect {
  switch (effect.type) {
    case 'LAYER_BLUR':
    case 'BACKGROUND_BLUR':
      return { ...effect, radius: scale(effect.radius, factor) };
    case 'DROP_SHADOW':
    case 'INNER_SHADOW':
      return {
        ...effect,
        radius: scale(effect.radius, factor),
        spread: effect.spread != null ? scale(effect.spread, factor) : effect.spread,
        offset: {
          x: scale(effect.offset.x, factor),
          y: scale(effect.offset.y, factor),
        },
      };
    default:
      return effect;
  }
}

function scaleGradientTransform(paint: Paint, factor: number): Paint {
  if (
    paint.type !== 'GRADIENT_LINEAR' &&
    paint.type !== 'GRADIENT_RADIAL' &&
    paint.type !== 'GRADIENT_ANGULAR'
  ) {
    return paint;
  }
  const [[a, b, e], [c, d, f]] = paint.gradientTransform;
  return {
    ...paint,
    gradientTransform: [
      [a, b, scaleExact(e, factor)],
      [c, d, scaleExact(f, factor)],
    ],
  };
}
