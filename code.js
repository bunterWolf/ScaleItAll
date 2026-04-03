"use strict";
// =============================================================================
// ScaleItAll — Plugin Logic (Figma Sandbox)
// Spec v6.2
// =============================================================================
figma.showUI(__html__, { width: 256, height: 320, title: 'ScaleItAll' });
// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
figma.ui.onmessage = async (msg) => {
    var _a;
    if (msg.type !== 'run')
        return;
    const factor = msg.factor;
    const steps = msg.steps;
    const selectionOnly = (_a = msg.selectionOnly) !== null && _a !== void 0 ? _a : false;
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
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendError(`Fehler: ${message}`);
    }
};
// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------
function sendProgress(text) {
    figma.ui.postMessage({ type: 'progress', text });
}
function sendDone(text) {
    figma.ui.postMessage({ type: 'done', text });
}
function sendError(text) {
    figma.ui.postMessage({ type: 'error', text });
}
// ---------------------------------------------------------------------------
// Scaling math
// ---------------------------------------------------------------------------
/** Standard pixel scale with minimum-1 rule */
function scale(value, factor) {
    const result = Math.round(value * factor);
    return value >= 1 ? Math.max(1, result) : result;
}
/** Scale without integer rounding (for vectors, gradient transforms) */
function scaleExact(value, factor) {
    return value * factor;
}
// ---------------------------------------------------------------------------
// Step 1 — Variables (FLOAT only)
// ---------------------------------------------------------------------------
async function runStep1(factor) {
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
async function runStep2(factor) {
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
async function runStep3(factor) {
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
function scaleEffect(effect, factor) {
    switch (effect.type) {
        case 'LAYER_BLUR':
        case 'BACKGROUND_BLUR':
            return Object.assign(Object.assign({}, effect), { radius: scale(effect.radius, factor) });
        case 'DROP_SHADOW':
        case 'INNER_SHADOW':
            return Object.assign(Object.assign({}, effect), { radius: scale(effect.radius, factor), spread: effect.spread != null ? scale(effect.spread, factor) : effect.spread, offset: {
                    x: scale(effect.offset.x, factor),
                    y: scale(effect.offset.y, factor),
                } });
        default:
            return effect;
    }
}
function scaleGradientTransform(paint, factor) {
    if (paint.type !== 'GRADIENT_LINEAR' &&
        paint.type !== 'GRADIENT_RADIAL' &&
        paint.type !== 'GRADIENT_ANGULAR') {
        return paint;
    }
    const [[a, b, e], [c, d, f]] = paint.gradientTransform;
    return Object.assign(Object.assign({}, paint), { gradientTransform: [
            [a, b, scaleExact(e, factor)],
            [c, d, scaleExact(f, factor)],
        ] });
}
// ---------------------------------------------------------------------------
// Step 4 — Canvas (bottom-up traversal, all pages)
// ---------------------------------------------------------------------------
async function runStep4(factor, onPageProgress) {
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
// ---------------------------------------------------------------------------
// Step 4 — Selection only (for testing)
// ---------------------------------------------------------------------------
async function runStep4Selection(factor) {
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
function yieldControl() {
    return new Promise(r => setTimeout(r, 0));
}
function buildOverrideMap(root) {
    const map = new Map();
    collectOverrides(root, map);
    return map;
}
function collectOverrides(node, map) {
    if (node.type === 'INSTANCE') {
        for (const override of node.overrides) {
            if (!map.has(override.id)) {
                map.set(override.id, new Set());
            }
            for (const field of override.overriddenFields) {
                map.get(override.id).add(field);
            }
        }
    }
    if ('children' in node) {
        for (const child of node.children) {
            collectOverrides(child, map);
        }
    }
}
function getPageAnchor(page) {
    const children = page.children;
    if (children.length === 0)
        return { x: 0, y: 0 };
    let minX = Infinity;
    let minY = Infinity;
    for (const child of children) {
        if ('x' in child && 'y' in child) {
            minX = Math.min(minX, child.x);
            minY = Math.min(minY, child.y);
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
async function traverseBottomUp(node, factor, overrideMap, anchor) {
    let count = 0;
    // Recurse into children first (bottom-up).
    // Per-child try/catch ensures a failing child never prevents the parent
    // from being processed (e.g. a tiny Vector whose resize would throw).
    if ('children' in node) {
        for (const child of node.children) {
            try {
                count += await traverseBottomUp(child, factor, overrideMap, anchor);
            }
            catch (err) {
                console.error(`[traverseBottomUp] skipped "${child.name}" (${child.type}):`, err);
            }
        }
    }
    // Skip page root itself
    if (node.type === 'PAGE' || node.type === 'DOCUMENT')
        return count;
    // Scale this node
    await scaleNode(node, factor, overrideMap, anchor);
    count++;
    return count;
}
// ---------------------------------------------------------------------------
// Node scaling — central dispatch
// ---------------------------------------------------------------------------
async function scaleNode(node, factor, overrideMap, anchor) {
    console.log(`[scaleNode] ${node.name} (${node.type})`);
    // An INSTANCE node itself is also subject to the override rule —
    // not just its descendants. Without this, width/height of an unmodified
    // instance would be written directly even though the master component
    // already propagates the correct scaled value.
    const isInstanceOrInsideInstance = node.type === 'INSTANCE' || isDescendantOfInstance(node);
    const overriddenFields = overrideMap.get(node.id);
    // Helper: can we write a given field?
    function canWrite(field) {
        // 1. Variable-bound? → skip
        if (isBoundToVariable(node, field))
            return false;
        // 2. Style-bound? → only relevant for effects / text handled separately
        // 3. Instance itself or descendant of instance?
        if (isInstanceOrInsideInstance) {
            return overriddenFields ? overriddenFields.has(field) : false;
        }
        // 4. SCALE constraint? → Figma will handle this axis automatically when
        //    the parent is resized. Writing directly would cause double-scaling.
        if (hasScaleConstraint(node, field))
            return false;
        return true;
    }
    // --- GROUP: only traverse children, write nothing ---
    if (node.type === 'GROUP')
        return;
    // --- BOOLEAN_OPERATION: skip, like GROUP ---
    // Children of a BOOLEAN_OPERATION use the parent frame's coordinate space
    // (not the BOOLEAN_OPERATION's local space).  The BOOLEAN_OPERATION's own
    // x/y is just the auto-computed bounding box of its children.  Scaling it
    // directly after children have already moved would double-scale its position.
    if (node.type === 'BOOLEAN_OPERATION')
        return;
    // --- VECTOR: no integer rounding ---
    if (node.type === 'VECTOR') {
        scaleVectorNode(node, factor, canWrite, anchor);
        scaleStrokes(node, factor, canWrite);
        return;
    }
    // --- SECTION: has no layoutSizing props, uses resizeWithoutConstraints ---
    if (node.type === 'SECTION') {
        scalePosition(node, factor, canWrite, anchor);
        const s = node;
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
function scalePosition(node, factor, canWrite, anchor) {
    if (!('x' in node && 'y' in node))
        return;
    const parent = node.parent;
    const isAbsolute = 'layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE';
    const parentIsAutoLayout = parent !== null &&
        'layoutMode' in parent &&
        parent.layoutMode !== 'NONE';
    // Children of a GROUP that lives inside an AutoLayout frame store their
    // coordinates in the AutoLayout frame's absolute space (not relative to the
    // GROUP).  On the AutoLayout axis, the GROUP is repositioned automatically
    // and children follow — explicitly scaling that axis conflicts with the
    // auto-repositioning and, for TEXT nodes, with STRETCH constraint
    // re-evaluation triggered by loadFontAsync, causing cascading position drift.
    // The cross-axis still needs manual scaling (e.g. y in a HORIZONTAL layout).
    const parentIsGroup = parent !== null && parent.type === 'GROUP';
    const groupParent = parentIsGroup ? parent.parent : null;
    const groupParentLayoutMode = groupParent !== null && 'layoutMode' in groupParent
        ? groupParent.layoutMode
        : 'NONE';
    const skipX = parentIsGroup && groupParentLayoutMode === 'HORIZONTAL';
    const skipY = parentIsGroup && groupParentLayoutMode === 'VERTICAL';
    // Write x/y only if parent is not AutoLayout, or node is absolute
    const shouldScaleXY = !parentIsAutoLayout || isAbsolute;
    if (!shouldScaleXY)
        return;
    // Top-level nodes (direct children of PAGE) are scaled relative to the
    // bounding-box anchor so that gaps between frames scale proportionally.
    // Nested nodes use simple multiplication (their x/y is already relative
    // to their parent frame, so proportions are inherently preserved).
    const isTopLevel = parent !== null && parent.type === 'PAGE';
    // Read constraints once for MAX handling below.
    const nodeConstraints = 'constraints' in node
        ? node.constraints
        : null;
    if (!skipX && canWrite('x')) {
        const x = node.x;
        if (!isTopLevel && (nodeConstraints === null || nodeConstraints === void 0 ? void 0 : nodeConstraints.horizontal) === 'MAX' && parent !== null && 'width' in parent) {
            // MAX = fixed distance from the parent's right edge.  Figma re-applies it
            // when the parent is resized, so we must not just do scale(x, factor) —
            // that would produce a wrong right-edge distance and the node would be
            // displaced a second time.
            // Formula: set x so that after MAX fires (parent resize) the node ends up
            // at exactly scale(old_x, factor).
            //   x_pre = parent.w − new_parent.w + scale(old_x, factor)
            const parentW = parent.width;
            const parentFixedW = 'layoutSizingHorizontal' in parent &&
                parent.layoutSizingHorizontal === 'FIXED';
            const newParentW = parentFixedW ? scale(parentW, factor) : parentW;
            node.x = parentW - newParentW + scale(x, factor);
        }
        else {
            node.x = isTopLevel
                ? anchor.x + Math.round((x - anchor.x) * factor)
                : scale(x, factor);
        }
    }
    if (!skipY && canWrite('y')) {
        const y = node.y;
        if (!isTopLevel && (nodeConstraints === null || nodeConstraints === void 0 ? void 0 : nodeConstraints.vertical) === 'MAX' && parent !== null && 'height' in parent) {
            const parentH = parent.height;
            const parentFixedH = 'layoutSizingVertical' in parent &&
                parent.layoutSizingVertical === 'FIXED';
            const newParentH = parentFixedH ? scale(parentH, factor) : parentH;
            node.y = parentH - newParentH + scale(y, factor);
        }
        else {
            node.y = isTopLevel
                ? anchor.y + Math.round((y - anchor.y) * factor)
                : scale(y, factor);
        }
    }
}
// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------
function scaleSize(node, factor, canWrite) {
    if (!('layoutSizingHorizontal' in node))
        return;
    const n = node;
    // TEXT nodes: calling resize() always resets textAutoResize to NONE, which
    // disables auto-sizing.  Preserve the original mode instead.
    if (node.type === 'TEXT') {
        const t = node;
        const autoResize = t.textAutoResize;
        if (autoResize === 'WIDTH_AND_HEIGHT') {
            // Both dimensions are driven by font size — skip resize entirely.
            // scaleTextProperties will scale fontSize; the text auto-resizes after.
            return;
        }
        if (autoResize === 'HEIGHT') {
            // Only width is fixed; scale it and restore HEIGHT mode so the height
            // continues to auto-fit after fontSize is scaled.
            if (n.layoutSizingHorizontal === 'FIXED' && canWrite('width')) {
                n.resize(scale(n.width, factor), n.height);
                t.textAutoResize = 'HEIGHT';
            }
            return;
        }
        // NONE / TRUNCATE: fall through to normal resize.
    }
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
function scaleAutoLayout(node, factor, canWrite) {
    var _a;
    if (!('layoutMode' in node)) {
        console.log(`[AutoLayout] SKIP ${node.name} (${node.type}): no layoutMode`);
        return;
    }
    const n = node;
    if (n.layoutMode === 'NONE') {
        console.log(`[AutoLayout] SKIP ${node.name} (${node.type}): layoutMode=NONE`);
        return;
    }
    console.log(`[AutoLayout] ${node.name} (${node.type}): layoutMode=${n.layoutMode} paddingTop=${n.paddingTop} canWrite(paddingTop)=${canWrite('paddingTop')} boundVar=${JSON.stringify((_a = node.boundVariables) === null || _a === void 0 ? void 0 : _a.paddingTop)}`);
    if (canWrite('paddingTop'))
        n.paddingTop = scale(n.paddingTop, factor);
    if (canWrite('paddingBottom'))
        n.paddingBottom = scale(n.paddingBottom, factor);
    if (canWrite('paddingLeft'))
        n.paddingLeft = scale(n.paddingLeft, factor);
    if (canWrite('paddingRight'))
        n.paddingRight = scale(n.paddingRight, factor);
    if (canWrite('itemSpacing'))
        n.itemSpacing = scale(n.itemSpacing, factor);
    if (n.layoutWrap === 'WRAP' && canWrite('counterAxisSpacing')) {
        const cas = n.counterAxisSpacing;
        if (typeof cas === 'number') {
            n.counterAxisSpacing = scale(cas, factor);
        }
    }
    if (n.minWidth !== null && canWrite('minWidth'))
        n.minWidth = scale(n.minWidth, factor);
    if (n.minHeight !== null && canWrite('minHeight'))
        n.minHeight = scale(n.minHeight, factor);
    if (n.maxWidth !== null && canWrite('maxWidth'))
        n.maxWidth = scale(n.maxWidth, factor);
    if (n.maxHeight !== null && canWrite('maxHeight'))
        n.maxHeight = scale(n.maxHeight, factor);
}
// ---------------------------------------------------------------------------
// Corner Radius
// ---------------------------------------------------------------------------
function scaleCornerRadius(node, factor, canWrite) {
    if (!('cornerRadius' in node))
        return;
    const n = node;
    if (n.cornerRadius !== figma.mixed) {
        if (canWrite('cornerRadius'))
            n.cornerRadius = scale(n.cornerRadius, factor);
    }
    else {
        if (canWrite('topLeftRadius'))
            n.topLeftRadius = scale(n.topLeftRadius, factor);
        if (canWrite('topRightRadius'))
            n.topRightRadius = scale(n.topRightRadius, factor);
        if (canWrite('bottomLeftRadius'))
            n.bottomLeftRadius = scale(n.bottomLeftRadius, factor);
        if (canWrite('bottomRightRadius'))
            n.bottomRightRadius = scale(n.bottomRightRadius, factor);
    }
}
// ---------------------------------------------------------------------------
// Strokes
// ---------------------------------------------------------------------------
function scaleStrokes(node, factor, canWrite) {
    if (!('strokeWeight' in node))
        return;
    const n = node;
    if (n.strokeWeight !== figma.mixed) {
        if (canWrite('strokeWeight'))
            n.strokeWeight = scaleExact(n.strokeWeight, factor);
    }
    else {
        const in_ = n;
        if (canWrite('strokeTopWeight'))
            in_.strokeTopWeight = scaleExact(in_.strokeTopWeight, factor);
        if (canWrite('strokeBottomWeight'))
            in_.strokeBottomWeight = scaleExact(in_.strokeBottomWeight, factor);
        if (canWrite('strokeLeftWeight'))
            in_.strokeLeftWeight = scaleExact(in_.strokeLeftWeight, factor);
        if (canWrite('strokeRightWeight'))
            in_.strokeRightWeight = scaleExact(in_.strokeRightWeight, factor);
    }
    if ('dashPattern' in n && canWrite('dashPattern')) {
        n.dashPattern = n.dashPattern.map(v => scaleExact(v, factor));
    }
}
// ---------------------------------------------------------------------------
// Effects (direct on node, not via style)
// ---------------------------------------------------------------------------
function scaleEffectsDirect(node, factor, canWrite) {
    if (!('effects' in node))
        return;
    if (!canWrite('effects'))
        return;
    if (isBoundToStyle(node, 'effects'))
        return;
    const n = node;
    n.effects = n.effects.map(e => scaleEffect(e, factor));
}
// ---------------------------------------------------------------------------
// Layout Grids
// ---------------------------------------------------------------------------
function scaleLayoutGrids(node, factor, canWrite) {
    if (node.type !== 'FRAME' &&
        node.type !== 'COMPONENT' &&
        node.type !== 'COMPONENT_SET')
        return;
    if (!canWrite('layoutGrids'))
        return;
    const n = node;
    n.layoutGrids = n.layoutGrids.map(grid => {
        if (grid.pattern === 'ROWS' || grid.pattern === 'COLUMNS') {
            return Object.assign(Object.assign({}, grid), { gutterSize: scale(grid.gutterSize, factor), sectionSize: grid.sectionSize != null ? scale(grid.sectionSize, factor) : grid.sectionSize, offset: grid.offset != null ? scale(grid.offset, factor) : grid.offset });
        }
        else if (grid.pattern === 'GRID') {
            return Object.assign(Object.assign({}, grid), { sectionSize: scale(grid.sectionSize, factor) });
        }
        return grid;
    });
}
// ---------------------------------------------------------------------------
// Guides (Frame only)
// ---------------------------------------------------------------------------
function scaleGuides(node, factor, canWrite) {
    if (node.type !== 'FRAME')
        return;
    if (!canWrite('guides'))
        return;
    const n = node;
    n.guides = n.guides.map(g => (Object.assign(Object.assign({}, g), { offset: scale(g.offset, factor) })));
}
// ---------------------------------------------------------------------------
// CSS Grid
// ---------------------------------------------------------------------------
function scaleCssGrid(node, factor, canWrite) {
    if (!('layoutMode' in node))
        return;
    const n = node;
    if (n.layoutMode !== 'GRID')
        return;
    if (canWrite('gridRowGap'))
        n.gridRowGap = scale(n.gridRowGap, factor);
    if (canWrite('gridColumnGap'))
        n.gridColumnGap = scale(n.gridColumnGap, factor);
    if (canWrite('gridRowSizes') && Array.isArray(n.gridRowSizes)) {
        n.gridRowSizes = n.gridRowSizes.map((entry) => entry.type === 'FIXED' ? Object.assign(Object.assign({}, entry), { value: scale(entry.value, factor) }) : entry);
    }
    if (canWrite('gridColumnSizes') && Array.isArray(n.gridColumnSizes)) {
        n.gridColumnSizes = n.gridColumnSizes.map((entry) => entry.type === 'FIXED' ? Object.assign(Object.assign({}, entry), { value: scale(entry.value, factor) }) : entry);
    }
}
// ---------------------------------------------------------------------------
// Text Properties (direct on node, not via style)
// ---------------------------------------------------------------------------
async function scaleTextProperties(node, factor, canWrite) {
    if (node.type !== 'TEXT')
        return;
    if (isBoundToStyle(node, 'textStyle'))
        return;
    // Load all fonts used in this node before any write
    const fonts = node.getRangeAllFontNames(0, node.characters.length);
    for (const font of fonts) {
        await figma.loadFontAsync(font);
    }
    const n = node;
    // fontSize
    if (canWrite('fontSize')) {
        if (n.fontSize !== figma.mixed) {
            n.fontSize = scale(n.fontSize, factor);
        }
        else {
            const len = n.characters.length;
            for (let i = 0; i < len;) {
                const size = n.getRangeFontSize(i, i + 1);
                let j = i + 1;
                while (j < len && n.getRangeFontSize(j, j + 1) === size)
                    j++;
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
            const lh = n.lineHeight;
            if (lh.unit === 'PIXELS')
                n.lineHeight = { unit: 'PIXELS', value: scale(lh.value, factor) };
        }
        else {
            const len = n.characters.length;
            for (let i = 0; i < len;) {
                const lh = n.getRangeLineHeight(i, i + 1);
                let j = i + 1;
                while (j < len) {
                    const next = n.getRangeLineHeight(j, j + 1);
                    if (JSON.stringify(next) !== JSON.stringify(lh))
                        break;
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
            const ls = n.letterSpacing;
            if (ls.unit === 'PIXELS')
                n.letterSpacing = { unit: 'PIXELS', value: scale(ls.value, factor) };
        }
        else {
            const len = n.characters.length;
            for (let i = 0; i < len;) {
                const ls = n.getRangeLetterSpacing(i, i + 1);
                let j = i + 1;
                while (j < len) {
                    const next = n.getRangeLetterSpacing(j, j + 1);
                    if (JSON.stringify(next) !== JSON.stringify(ls))
                        break;
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
function scaleVectorNode(node, factor, canWrite, anchor) {
    var _a, _b;
    const parent = node.parent;
    const isTopLevel = parent !== null && parent.type === 'PAGE';
    // Same guard as scalePosition: skip x/y when AutoLayout owns the position,
    // unless the node is explicitly absolute-positioned.
    const isAbsolute = 'layoutPositioning' in node &&
        node.layoutPositioning === 'ABSOLUTE';
    const parentIsAutoLayout = parent !== null &&
        'layoutMode' in parent &&
        parent.layoutMode !== 'NONE';
    const shouldScaleXY = !parentIsAutoLayout || isAbsolute;
    const constraints = 'constraints' in node
        ? node.constraints
        : null;
    const hC = (_a = constraints === null || constraints === void 0 ? void 0 : constraints.horizontal) !== null && _a !== void 0 ? _a : 'MIN';
    const vC = (_b = constraints === null || constraints === void 0 ? void 0 : constraints.vertical) !== null && _b !== void 0 ? _b : 'MIN';
    // ── SCALE-involved axes ───────────────────────────────────────────────────
    // If EITHER axis has a SCALE constraint we must not rely on the parent
    // resize to scale this vector.  Constraint changes made during a plugin
    // transaction do not take effect before the parent's resize() call in the
    // same transaction, so the old constraint is still applied by Figma at
    // resize time.  For example, horizontal=SCALE + vertical=CENTER would
    // scale only the width while leaving the height unchanged — distorting the
    // vector.
    //
    // Fix: resize the vector manually and uniformly here (same factor on both
    // axes → no path distortion), then demote any SCALE constraint to MIN so
    // that the subsequent parent resize does not double-scale this node.
    if (hC === 'SCALE' || vC === 'SCALE') {
        const oldX = node.x;
        const oldY = node.y;
        const oldW = node.width;
        const oldH = node.height;
        const MIN_DIM = 0.01;
        const newW = Math.max(MIN_DIM, scaleExact(oldW, factor));
        const newH = Math.max(MIN_DIM, scaleExact(oldH, factor));
        node.resize(newW, newH);
        // Demote SCALE → MIN to prevent double-scaling when the parent is resized.
        node.constraints = {
            horizontal: hC === 'SCALE' ? 'MIN' : hC,
            vertical: vC === 'SCALE' ? 'MIN' : vC,
        };
        // Position: SCALE and MIN axes need manual scaling; CENTER axes need the
        // standard post-resize correction.
        if (shouldScaleXY) {
            if ((hC === 'SCALE' || hC === 'MIN') && canWrite('x')) {
                node.x = isTopLevel
                    ? anchor.x + (oldX - anchor.x) * factor
                    : scaleExact(oldX, factor);
            }
            if ((vC === 'SCALE' || vC === 'MIN') && canWrite('y')) {
                node.y = isTopLevel
                    ? anchor.y + (oldY - anchor.y) * factor
                    : scaleExact(oldY, factor);
            }
            if (hC === 'CENTER' && canWrite('x')) {
                node.x = oldX + (oldW - newW) / 2;
            }
            if (vC === 'CENTER' && canWrite('y')) {
                node.y = oldY + (oldH - newH) / 2;
            }
        }
        return;
    }
    // ── No SCALE constraint — handle manually ─────────────────────────────────
    // Position: MIN needs explicit scaling.  CENTER must also be scaled manually
    // and then demoted to MIN — Figma's CENTER constraint maintains a *constant
    // offset* from the parent's centre point (not a proportional fraction), so
    // when the parent is resized it would displace the child by the wrong amount.
    // MAX and STRETCH are auto-handled by the parent resize and need no manual
    // position adjustment here.
    if (shouldScaleXY) {
        if ((hC === 'MIN' || hC === 'CENTER') && canWrite('x')) {
            node.x = isTopLevel
                ? anchor.x + (node.x - anchor.x) * factor
                : scaleExact(node.x, factor);
        }
        if ((vC === 'MIN' || vC === 'CENTER') && canWrite('y')) {
            node.y = isTopLevel
                ? anchor.y + (node.y - anchor.y) * factor
                : scaleExact(node.y, factor);
        }
    }
    // Demote CENTER → MIN so the parent resize does not override the manually
    // scaled position with a constant-offset repositioning.
    if (hC === 'CENTER' || vC === 'CENTER') {
        node.constraints = {
            horizontal: hC === 'CENTER' ? 'MIN' : hC,
            vertical: vC === 'CENTER' ? 'MIN' : vC,
        };
    }
    // Size: STRETCH is auto-sized by parent → keep original; all others scale.
    // Both axes use the same factor → resize is always uniform → no distortion.
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
}
// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------
function isBoundToVariable(node, field) {
    if (!('boundVariables' in node))
        return false;
    const bv = node.boundVariables;
    return bv != null && field in bv && bv[field] != null;
}
function isBoundToStyle(node, field) {
    // effects style
    if (field === 'effects' && 'effectStyleId' in node) {
        return !!node.effectStyleId;
    }
    // text style
    if (field === 'textStyle' && node.type === 'TEXT') {
        return !!node.textStyleId;
    }
    return false;
}
function isDescendantOfInstance(node) {
    var _a;
    let current = node.parent;
    while (current !== null) {
        if (current.type === 'INSTANCE')
            return true;
        current = (_a = current.parent) !== null && _a !== void 0 ? _a : null;
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
function hasScaleConstraint(node, field) {
    if (!('constraints' in node))
        return false;
    const c = node.constraints;
    if ((field === 'x' || field === 'width') && c.horizontal === 'SCALE')
        return true;
    if ((field === 'y' || field === 'height') && c.vertical === 'SCALE')
        return true;
    return false;
}
