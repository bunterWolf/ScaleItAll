// =============================================================================
// Step 2 — Text Styles
// =============================================================================

import { scale } from './utils';

export async function runStep2(factor: number): Promise<void> {
  const styles = await figma.getLocalTextStylesAsync();
  for (const style of styles) {
    await figma.loadFontAsync(style.fontName);

    style.fontSize = scale(style.fontSize, factor);

    const lh = style.lineHeight;
    if (lh.unit === 'PIXELS') {
      style.lineHeight = { unit: 'PIXELS', value: scale(lh.value, factor) };
    }

    const ls = style.letterSpacing;
    if (ls.unit === 'PIXELS') {
      style.letterSpacing = { unit: 'PIXELS', value: scale(ls.value, factor) };
    }
  }
}
