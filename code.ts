// =============================================================================
// ScaleItAll — Plugin Logic (Figma Sandbox)
// Spec v6.0
// =============================================================================

figma.showUI(__html__, { width: 256, height: 320, title: 'ScaleItAll' });

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
figma.ui.onmessage = async (msg) => {
  if (msg.type !== 'run') return;

  const factor: number = msg.factor;
  const steps: number[] = msg.steps;
  const selectionOnly: boolean = msg.selectionOnly ?? false;

  let totalNodes = 0;
  let totalPages = 0;

  try {
    for (const step of steps) {
      switch (step) {
        case 1:
          sendProgress('Schritt 1 — Variables…');
          await runStep1(factor);
          break;
        case 2:
          sendProgress('Schritt 2 — Text Styles…');
          await runStep2(factor);
          break;
        case 3:
          sendProgress('Schritt 3 — Effect & Paint Styles…');
          await runStep3(factor);
          break;
        case 4: {
          const result = selectionOnly
            ? await runStep4Selection(factor)
            : await runStep4(factor, (pageIndex, pageCount, pageName) => {
                sendProgress(`Schritt 4 — Canvas — Seite ${pageIndex} / ${pageCount}: ${pageName}`);
              });
          totalNodes += result.nodes;
          totalPages += result.pages;
          break;
        }
      }
    }

    const summary = steps.includes(4)
      ? `Fertig — ${totalPages} Seiten, ${totalNodes} Nodes skaliert`
      : `Fertig`;
    sendDone(summary);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(`Fehler: ${message}`);
  }
};

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------
function sendProgress(text: string) {
  figma.ui.postMessage({ type: 'progress', text });
}
function sendDone(text: string) {
  figma.ui.postMessage({ type: 'done', text });
}
function sendError(text: string) {
  figma.ui.postMessage({ type: 'error', text });
}

// ---------------------------------------------------------------------------
// Scaling math
// ---------------------------------------------------------------------------

/** Standard pixel scale with minimum-1 rule */
function scale(value: number, factor: number): number {
  const result = Math.round(value * factor);
  return value >= 1 ? Math.max(1, result) : result;
}

/** Scale without integer rounding (for vectors, gradient transforms) */
function scaleExact(value: number, factor: number): number {
  return value * factor;
}

// ---------------------------------------------------------------------------
// Step 1 — Variables (FLOAT only)
// ---------------------------------------------------------------------------
async function runStep1(factor: number): Promise<void> {
  const localVars = await figma.variables.getLocalVariablesAsync('FLOAT');
  for (const variable of localVars) {
    for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
      if (typeof value === 'number') {
        variable.setValueForMode(modeId, scale(value, factor));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Step 2 — Text Styles
// ---------------------------------------------------------------------------
async function runStep2(factor: number): Promise<void> {
  const styles = await figma.getLocalTextStylesAsync();
  for (const style of styles) {
    // Font must be loaded before any write
    await figma.loadFontAsync(style.fontName);

    // fontSize always
    style.fontSize = scale(style.fontSize, factor);

    // lineHeight — only PIXELS
    const lh = style.lineHeight;
    if (lh.unit === 'PIXELS') {
      style.lineHeight = { unit: 'PIXELS', value: scale(lh.value, factor) };
    }

    // letterSpacing — only PIXELS
    const ls = style.letterSpacing;
    if (ls.unit === 'PIXELS') {
      style.letterSpacing = { unit: 'PIXELS', value: scale(ls.value, factor) };
    }
  }
}

// ---------------------------------------------------------------------------
// Step 3 — Effect Styles & Paint Styles
// ---------------------------------------------------------------------------
async function runStep3(factor: number): Promise<void> {
  // Effect Styles
  const effectStyles = await figma.getLocalEffectStylesAsync();
  for (const style of effectStyles) {
    style.effects = style.effects.map(effect => scaleEffect(effect, factor));
  }

  // Paint Styles — gradient transforms only
  const paintStyles = await figma.getLocalPaintStylesAsync();
  for (const style of paintStyles) {
    style.paints = style.paints.map(paint => scaleGradientTransform(paint, factor));
  }
}

function scaleEffect(effect: Effect, factor: number): Effect {
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

// ---------------------------------------------------------------------------
// Step 4 — Canvas (bottom-up traversal, all pages)
// ---------------------------------------------------------------------------
async function runStep4(
  factor: number,
  onPageProgress: (index: number, total: number, name: string) => void
): Promise<{ nodes: number; pages: number }> {
  let totalNodes = 0;
  const pages = figma.root.children; // PageNode[]
  const pageCount = pages.length;

  for (let i = 0; i < pageCount; i++) {
    const page = pages[i];
    onPageProgress(i + 1, pageCount, page.name);

    // Yield so UI updates
    await yieldControl();

    // Build override map for instances on this page
    const overrideMap = buildOverrideMap(page);

    // Anchor = top-left corner of bounding box of all top-level nodes.
    // All canvas positions are scaled relative to this point so that
    // proportional gaps between frames are preserved.
    const anchor = getPageAnchor(page);

    // Bottom-up traversal
    const count = await traverseBottomUp(page, factor, overrideMap, anchor);
    totalNodes += count;

    // Yield between pages
    await yieldControl();
  }

  return { nodes: totalNodes, pages: pageCount };
}

declare function setTimeout(fn: () => void, ms: number): number;

// ---------------------------------------------------------------------------
// Step 4 — Selection only (for testing)
// ---------------------------------------------------------------------------
async function runStep4Selection(factor: number): Promise<{ nodes: number; pages: number }> {
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

function yieldControl(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Override map — collects all instance overrides on a subtree
// ---------------------------------------------------------------------------
type OverrideMap = Map<string, Set<string>>; // nodeId → Set<overriddenField>

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
interface Anchor { x: number; y: number; }

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

// ---------------------------------------------------------------------------
// Bottom-up traversal
// ---------------------------------------------------------------------------
async function traverseBottomUp(node: BaseNode, factor: number, overrideMap: OverrideMap, anchor: Anchor): Promise<number> {
  let count = 0;

  // Recurse into children first (bottom-up).
  // Per-child try/catch ensures a failing child never prevents the parent
  // from being processed (e.g. a tiny Vector whose resize would throw).
  if ('children' in node) {
    for (const child of (node as ChildrenMixin).children) {
      try {
        count += await traverseBottomUp(child, factor, overrideMap, anchor);
      } catch (err) {
        console.error(`[traverseBottomUp] skipped "${(child as any).name}" (${(child as any).type}):`, err);
      }
    }
  }

  // Skip page root itself
  if (node.type === 'PAGE' || node.type === 'DOCUMENT') return count;

  // Scale this node
  await scaleNode(node as SceneNode, factor, overrideMap, anchor);
  count++;

  return count;
}

// ---------------------------------------------------------------------------
// Node scaling — central dispatch
// ---------------------------------------------------------------------------
async function scaleNode(node: SceneNode, factor: number, overrideMap: OverrideMap, anchor: Anchor): Promise<void> {
  console.log(`[scaleNode] ${node.name} (${node.type})`);

  // An INSTANCE node itself is also subject to the override rule —
  // not just its descendants. Without this, width/height of an unmodified
  // instance would be written directly even though the master component
  // already propagates the correct scaled value.
  const isInstanceOrInsideInstance =
    node.type === 'INSTANCE' || isDescendantOfInstance(node);
  const overriddenFields = overrideMap.get(node.id);

  // Helper: can we write a given field?
  function canWrite(field: string): boolean {
    // 1. Variable-bound? → skip
    if (isBoundToVariable(node, field)) return false;
    // 2. Style-bound? → only relevant for effects / text handled separately
    // 3. Instance itself or descendant of instance?
    if (isInstanceOrInsideInstance) {
      return overriddenFields ? overriddenFields.has(field) : false;
    }
    // 4. SCALE constraint? → Figma will handle this axis automatically when
    //    the parent is resized. Writing directly would cause double-scaling.
    if (hasScaleConstraint(node, field)) return false;
    return true;
  }

  // --- GROUP: only traverse children, write nothing ---
  if (node.type === 'GROUP') return;

  // --- BOOLEAN_OPERATION: only x/y ---
  if (node.type === 'BOOLEAN_OPERATION') {
    scalePosition(node, factor, canWrite, anchor);
    return;
  }

  // --- VECTOR: no integer rounding ---
  if (node.type === 'VECTOR') {
    scaleVectorNode(node, factor, canWrite, anchor);
    return;
  }

  // --- SECTION: has no layoutSizing props, uses resizeWithoutConstraints ---
  if (node.type === 'SECTION') {
    scalePosition(node, factor, canWrite, anchor);
    const s = node as SectionNode;
    s.resizeWithoutConstraints(scale(s.width, factor), scale(s.height, factor));
    return;
  }

  // --- All other nodes ---
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

  // Write x/y only if parent is not AutoLayout, or node is absolute
  const shouldScaleXY = !parentIsAutoLayout || isAbsolute;
  if (!shouldScaleXY) return;

  // Top-level nodes (direct children of PAGE) are scaled relative to the
  // bounding-box anchor so that gaps between frames scale proportionally.
  // Nested nodes use simple multiplication (their x/y is already relative
  // to their parent frame, so proportions are inherently preserved).
  const isTopLevel = parent !== null && parent.type === 'PAGE';

  if (canWrite('x')) {
    const x = (node as any).x as number;
    (node as any).x = isTopLevel
      ? anchor.x + Math.round((x - anchor.x) * factor)
      : scale(x, factor);
  }
  if (canWrite('y')) {
    const y = (node as any).y as number;
    (node as any).y = isTopLevel
      ? anchor.y + Math.round((y - anchor.y) * factor)
      : scale(y, factor);
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

  if (n.layoutSizingHorizontal === 'FIXED' && canWrite('width')) {
    n.resize(scale(n.width, factor), n.height);
  }
  if (n.layoutSizingVertical === 'FIXED' && canWrite('height')) {
    n.resize(n.width, scale(n.height, factor));
  }
}

// ---------------------------------------------------------------------------
// AutoLayout
// ---------------------------------------------------------------------------
function scaleAutoLayout(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean
): void {
  if (!('layoutMode' in node)) {
    console.log(`[AutoLayout] SKIP ${node.name} (${node.type}): no layoutMode`);
    return;
  }
  const n = node as FrameNode;
  if (n.layoutMode === 'NONE') {
    console.log(`[AutoLayout] SKIP ${node.name} (${node.type}): layoutMode=NONE`);
    return;
  }

  console.log(`[AutoLayout] ${node.name} (${node.type}): layoutMode=${n.layoutMode} paddingTop=${n.paddingTop} canWrite(paddingTop)=${canWrite('paddingTop')} boundVar=${JSON.stringify((node as any).boundVariables?.paddingTop)}`);

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

// ---------------------------------------------------------------------------
// Corner Radius
// ---------------------------------------------------------------------------
function scaleCornerRadius(
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

// ---------------------------------------------------------------------------
// Strokes
// ---------------------------------------------------------------------------
function scaleStrokes(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean
): void {
  if (!('strokeWeight' in node)) return;
  const n = node as GeometryMixin & SceneNode;

  if (n.strokeWeight !== figma.mixed) {
    if (canWrite('strokeWeight')) (n as any).strokeWeight = scale(n.strokeWeight as number, factor);
  } else {
    const in_ = n as IndividualStrokesMixin & SceneNode;
    if (canWrite('strokeTopWeight'))    in_.strokeTopWeight    = scale(in_.strokeTopWeight,    factor);
    if (canWrite('strokeBottomWeight')) in_.strokeBottomWeight = scale(in_.strokeBottomWeight, factor);
    if (canWrite('strokeLeftWeight'))   in_.strokeLeftWeight   = scale(in_.strokeLeftWeight,   factor);
    if (canWrite('strokeRightWeight'))  in_.strokeRightWeight  = scale(in_.strokeRightWeight,  factor);
  }

  if ('dashPattern' in n && canWrite('dashPattern')) {
    (n as any).dashPattern = (n as GeometryMixin).dashPattern.map(v => scale(v, factor));
  }
}

// ---------------------------------------------------------------------------
// Effects (direct on node, not via style)
// ---------------------------------------------------------------------------
function scaleEffectsDirect(
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

// ---------------------------------------------------------------------------
// Layout Grids
// ---------------------------------------------------------------------------
function scaleLayoutGrids(
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

// ---------------------------------------------------------------------------
// Guides (Frame only)
// ---------------------------------------------------------------------------
function scaleGuides(
  node: SceneNode,
  factor: number,
  canWrite: (field: string) => boolean
): void {
  if (node.type !== 'FRAME') return;
  if (!canWrite('guides')) return;
  const n = node as FrameNode;
  n.guides = n.guides.map(g => ({ ...g, offset: scale(g.offset, factor) }));
}

// ---------------------------------------------------------------------------
// CSS Grid
// ---------------------------------------------------------------------------
function scaleCssGrid(
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

// ---------------------------------------------------------------------------
// Text Properties (direct on node, not via style)
// ---------------------------------------------------------------------------
async function scaleTextProperties(
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

// ---------------------------------------------------------------------------
// VECTOR nodes (no integer rounding)
// ---------------------------------------------------------------------------
function scaleVectorNode(
  node: VectorNode,
  factor: number,
  canWrite: (field: string) => boolean,
  anchor: Anchor
): void {
  const parent = node.parent;
  const isTopLevel = parent !== null && parent.type === 'PAGE';

  // Same guard as scalePosition: skip x/y when AutoLayout owns the position,
  // unless the node is explicitly absolute-positioned.
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
  // If EITHER axis has a SCALE constraint we cannot do a partial resize:
  // we would have to keep the SCALE axis at its original size and only resize
  // the other axis, which is a non-uniform resize.  For vector nodes a
  // non-uniform resize permanently distorts the path geometry and image-fill
  // transforms (the intermediate non-square bbox bakes the distortion in
  // before SCALE fires on parent resize).
  //
  // Fix: ensure both axes are SCALE so the parent resize scales the vector
  // uniformly — no manual resize needed at all.
  if (hC === 'SCALE' || vC === 'SCALE') {
    if (hC !== 'SCALE' || vC !== 'SCALE') {
      // Promote the non-SCALE axis to SCALE for uniform parent-driven scaling.
      (node as ConstraintMixin).constraints = { horizontal: 'SCALE', vertical: 'SCALE' };
    }
    // Delegate position and size entirely to parent resize — nothing more to do.
    return;
  }

  // ── No SCALE constraint — handle manually ─────────────────────────────────
  // Position: only write x/y when the constraint won't auto-reposition on
  // parent resize.  MIN (fixed from top/left) needs manual scaling; CENTER,
  // MAX, and STRETCH are repositioned automatically by Figma.
  if (shouldScaleXY) {
    if (hC === 'MIN' && canWrite('x')) {
      (node as any).x = isTopLevel
        ? anchor.x + (node.x - anchor.x) * factor
        : scaleExact(node.x, factor);
    }
    if (vC === 'MIN' && canWrite('y')) {
      (node as any).y = isTopLevel
        ? anchor.y + (node.y - anchor.y) * factor
        : scaleExact(node.y, factor);
    }
  }

  // Size: STRETCH is auto-sized by parent → keep original; all others scale.
  // Here both axes use the same factor → the resize is always uniform →
  // no path or fill distortion.
  const hManual = hC !== 'STRETCH' && canWrite('width');
  const vManual = vC !== 'STRETCH' && canWrite('height');

  if (hManual || vManual) {
    const oldX = node.x;
    const oldY = node.y;
    const oldW = node.width;
    const oldH = node.height;
    const MIN_DIM = 0.01;

    const newW = hManual ? Math.max(MIN_DIM, scaleExact(oldW, factor)) : oldW;
    const newH = vManual ? Math.max(MIN_DIM, scaleExact(oldH, factor)) : oldH;
    node.resize(newW, newH);

    // CENTER constraint: Figma tracks the node's centre as a fraction of the
    // parent.  After resizing, the centre shifts (top-left stays, node shrinks
    // inward).  Slide the node so the centre fraction is preserved — Figma
    // will then apply the correct position when the parent is resized.
    //   new_pos = old_pos + (old_dim − new_dim) / 2
    if (shouldScaleXY) {
      if (hC === 'CENTER' && canWrite('x')) {
        (node as any).x = oldX + (oldW - newW) / 2;
      }
      if (vC === 'CENTER' && canWrite('y')) {
        (node as any).y = oldY + (oldH - newH) / 2;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------
function isBoundToVariable(node: SceneNode, field: string): boolean {
  if (!('boundVariables' in node)) return false;
  const bv = (node as any).boundVariables;
  return bv != null && field in bv && bv[field] != null;
}

function isBoundToStyle(node: SceneNode, field: string): boolean {
  // effects style
  if (field === 'effects' && 'effectStyleId' in node) {
    return !!(node as BlendMixin).effectStyleId;
  }
  // text style
  if (field === 'textStyle' && node.type === 'TEXT') {
    return !!(node as TextNode).textStyleId;
  }
  return false;
}

function isDescendantOfInstance(node: SceneNode): boolean {
  let current: BaseNode | null = node.parent;
  while (current !== null) {
    if (current.type === 'INSTANCE') return true;
    current = (current as SceneNode).parent ?? null;
  }
  return false;
}

/**
 * Returns true if the given field is controlled by a SCALE constraint on this
 * node. Writing to such a field directly would cause double-scaling: once from
 * our direct write (bottom-up, before parent resize) and once from Figma
 * automatically re-applying the SCALE constraint when the parent is resized.
 *
 * Fields affected:
 *   horizontal SCALE → 'x', 'width'
 *   vertical   SCALE → 'y', 'height'
 */
function hasScaleConstraint(node: SceneNode, field: string): boolean {
  if (!('constraints' in node)) return false;
  const c = (node as ConstraintMixin).constraints;
  if ((field === 'x' || field === 'width')  && c.horizontal === 'SCALE') return true;
  if ((field === 'y' || field === 'height') && c.vertical   === 'SCALE') return true;
  return false;
}
