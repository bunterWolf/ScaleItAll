// =============================================================================
// Text property scaling (direct on node, not via style)
// =============================================================================

import { scale } from './utils';
import { isBoundToStyle } from './guards';

export async function scaleTextProperties(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean
): Promise<void> {
  if (node.type !== 'TEXT') return;
  if (isBoundToStyle(node, 'textStyle')) return;

  // Load all fonts used in this node before any write
  const fonts = node.getRangeAllFontNames(0, node.characters.length);
  for (const font of fonts) {
    await figma.loadFontAsync(font);
  }

  const n = node as TextNode;

  // fontSize
  if (canWrite('fontSize')) {
    if (n.fontSize !== figma.mixed) {
      n.fontSize = scale(n.fontSize as number, factor);
    } else {
      const len = n.characters.length;
      for (let i = 0; i < len; ) {
        const size = n.getRangeFontSize(i, i + 1);
        let j = i + 1;
        while (j < len && n.getRangeFontSize(j, j + 1) === size) j++;
        if (typeof size === 'number') {
          n.setRangeFontSize(i, j, scale(size, factor));
        }
        i = j;
      }
    }
  }

  // lineHeight
  if (canWrite('lineHeight')) {
    if (n.lineHeight !== figma.mixed) {
      const lh = n.lineHeight as LineHeight;
      if (lh.unit === 'PIXELS') n.lineHeight = { unit: 'PIXELS', value: scale(lh.value, factor) };
    } else {
      const len = n.characters.length;
      for (let i = 0; i < len; ) {
        const lh = n.getRangeLineHeight(i, i + 1) as LineHeight;
        let j = i + 1;
        while (j < len) {
          const next = n.getRangeLineHeight(j, j + 1) as LineHeight;
          if (JSON.stringify(next) !== JSON.stringify(lh)) break;
          j++;
        }
        if (lh.unit === 'PIXELS') {
          n.setRangeLineHeight(i, j, { unit: 'PIXELS', value: scale(lh.value, factor) });
        }
        i = j;
      }
    }
  }

  // letterSpacing
  if (canWrite('letterSpacing')) {
    if (n.letterSpacing !== figma.mixed) {
      const ls = n.letterSpacing as LetterSpacing;
      if (ls.unit === 'PIXELS') n.letterSpacing = { unit: 'PIXELS', value: scale(ls.value, factor) };
    } else {
      const len = n.characters.length;
      for (let i = 0; i < len; ) {
        const ls = n.getRangeLetterSpacing(i, i + 1) as LetterSpacing;
        let j = i + 1;
        while (j < len) {
          const next = n.getRangeLetterSpacing(j, j + 1) as LetterSpacing;
          if (JSON.stringify(next) !== JSON.stringify(ls)) break;
          j++;
        }
        if (ls.unit === 'PIXELS') {
          n.setRangeLetterSpacing(i, j, { unit: 'PIXELS', value: scale(ls.value, factor) });
        }
        i = j;
      }
    }
  }

  // listSpacing
  if (canWrite('listSpacing') && typeof n.listSpacing === 'number') {
    n.listSpacing = scale(n.listSpacing, factor);
  }
}
