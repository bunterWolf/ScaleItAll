"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // src/utils.ts
  function scale(value, factor) {
    const result = Math.round(value * factor);
    return value >= 1 ? Math.max(1, result) : result;
  }
  function scaleExact(value, factor) {
    return value * factor;
  }
  function yieldControl() {
    return new Promise((r) => setTimeout(r, 0));
  }
  function sendProgress(text) {
    figma.ui.postMessage({ type: "progress", text });
  }
  function sendDone(text) {
    figma.ui.postMessage({ type: "done", text });
  }
  function sendError(text) {
    figma.ui.postMessage({ type: "error", text });
  }

  // src/scale-variables.ts
  async function runStep1(factor) {
    const localVars = await figma.variables.getLocalVariablesAsync("FLOAT");
    for (const variable of localVars) {
      for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
        if (typeof value === "number") {
          variable.setValueForMode(modeId, scale(value, factor));
        }
      }
    }
  }

  // src/scale-text-styles.ts
  async function runStep2(factor) {
    const styles = await figma.getLocalTextStylesAsync();
    for (const style of styles) {
      await figma.loadFontAsync(style.fontName);
      style.fontSize = scale(style.fontSize, factor);
      const lh = style.lineHeight;
      if (lh.unit === "PIXELS") {
        style.lineHeight = { unit: "PIXELS", value: scale(lh.value, factor) };
      }
      const ls = style.letterSpacing;
      if (ls.unit === "PIXELS") {
        style.letterSpacing = { unit: "PIXELS", value: scale(ls.value, factor) };
      }
    }
  }

  // src/scale-effect-paint-styles.ts
  async function runStep3(factor) {
    const effectStyles = await figma.getLocalEffectStylesAsync();
    for (const style of effectStyles) {
      style.effects = style.effects.map((effect) => scaleEffect(effect, factor));
    }
    const paintStyles = await figma.getLocalPaintStylesAsync();
    for (const style of paintStyles) {
      style.paints = style.paints.map((paint) => scaleGradientTransform(paint, factor));
    }
  }
  function scaleEffect(effect, factor) {
    switch (effect.type) {
      case "LAYER_BLUR":
      case "BACKGROUND_BLUR":
        return __spreadProps(__spreadValues({}, effect), { radius: scale(effect.radius, factor) });
      case "DROP_SHADOW":
      case "INNER_SHADOW":
        return __spreadProps(__spreadValues({}, effect), {
          radius: scale(effect.radius, factor),
          spread: effect.spread != null ? scale(effect.spread, factor) : effect.spread,
          offset: {
            x: scale(effect.offset.x, factor),
            y: scale(effect.offset.y, factor)
          }
        });
      default:
        return effect;
    }
  }
  function scaleGradientTransform(paint, factor) {
    if (paint.type !== "GRADIENT_LINEAR" && paint.type !== "GRADIENT_RADIAL" && paint.type !== "GRADIENT_ANGULAR") {
      return paint;
    }
    const [[a, b, e], [c, d, f]] = paint.gradientTransform;
    return __spreadProps(__spreadValues({}, paint), {
      gradientTransform: [
        [a, b, scaleExact(e, factor)],
        [c, d, scaleExact(f, factor)]
      ]
    });
  }

  // src/guards.ts
  function isBoundToVariable(node, field) {
    if (!("boundVariables" in node)) return false;
    const bv = node.boundVariables;
    return bv != null && field in bv && bv[field] != null;
  }
  function isBoundToStyle(node, field) {
    if (field === "effects" && "effectStyleId" in node) {
      return !!node.effectStyleId;
    }
    if (field === "textStyle" && node.type === "TEXT") {
      return !!node.textStyleId;
    }
    return false;
  }
  function isDescendantOfInstance(node) {
    var _a;
    let current = node.parent;
    while (current !== null) {
      if (current.type === "INSTANCE") return true;
      current = (_a = current.parent) != null ? _a : null;
    }
    return false;
  }
  function hasScaleConstraint(node, field) {
    if (!("constraints" in node)) return false;
    const c = node.constraints;
    if ((field === "x" || field === "width") && c.horizontal === "SCALE") return true;
    if ((field === "y" || field === "height") && c.vertical === "SCALE") return true;
    return false;
  }

  // src/scale-layout.ts
  function scaleAutoLayout(node, factor, canWrite) {
    if (!("layoutMode" in node)) return;
    const n = node;
    if (n.layoutMode === "NONE") return;
    if (canWrite("paddingTop")) n.paddingTop = scale(n.paddingTop, factor);
    if (canWrite("paddingBottom")) n.paddingBottom = scale(n.paddingBottom, factor);
    if (canWrite("paddingLeft")) n.paddingLeft = scale(n.paddingLeft, factor);
    if (canWrite("paddingRight")) n.paddingRight = scale(n.paddingRight, factor);
    if (canWrite("itemSpacing")) n.itemSpacing = scale(n.itemSpacing, factor);
    if (n.layoutWrap === "WRAP" && canWrite("counterAxisSpacing")) {
      const cas = n.counterAxisSpacing;
      if (typeof cas === "number") {
        n.counterAxisSpacing = scale(cas, factor);
      }
    }
    if (n.minWidth !== null && canWrite("minWidth")) n.minWidth = scale(n.minWidth, factor);
    if (n.minHeight !== null && canWrite("minHeight")) n.minHeight = scale(n.minHeight, factor);
    if (n.maxWidth !== null && canWrite("maxWidth")) n.maxWidth = scale(n.maxWidth, factor);
    if (n.maxHeight !== null && canWrite("maxHeight")) n.maxHeight = scale(n.maxHeight, factor);
  }
  function scaleLayoutGrids(node, factor, canWrite) {
    if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") return;
    if (!canWrite("layoutGrids")) return;
    const n = node;
    n.layoutGrids = n.layoutGrids.map((grid) => {
      if (grid.pattern === "ROWS" || grid.pattern === "COLUMNS") {
        return __spreadProps(__spreadValues({}, grid), {
          gutterSize: scale(grid.gutterSize, factor),
          sectionSize: grid.sectionSize != null ? scale(grid.sectionSize, factor) : grid.sectionSize,
          offset: grid.offset != null ? scale(grid.offset, factor) : grid.offset
        });
      } else if (grid.pattern === "GRID") {
        return __spreadProps(__spreadValues({}, grid), { sectionSize: scale(grid.sectionSize, factor) });
      }
      return grid;
    });
  }
  function scaleGuides(node, factor, canWrite) {
    if (node.type !== "FRAME") return;
    if (!canWrite("guides")) return;
    const n = node;
    n.guides = n.guides.map((g) => __spreadProps(__spreadValues({}, g), { offset: scale(g.offset, factor) }));
  }
  function scaleCssGrid(node, factor, canWrite) {
    if (!("layoutMode" in node)) return;
    const n = node;
    if (n.layoutMode !== "GRID") return;
    if (canWrite("gridRowGap")) n.gridRowGap = scale(n.gridRowGap, factor);
    if (canWrite("gridColumnGap")) n.gridColumnGap = scale(n.gridColumnGap, factor);
    if (canWrite("gridRowSizes") && Array.isArray(n.gridRowSizes)) {
      n.gridRowSizes = n.gridRowSizes.map(
        (entry) => entry.type === "FIXED" ? __spreadProps(__spreadValues({}, entry), { value: scale(entry.value, factor) }) : entry
      );
    }
    if (canWrite("gridColumnSizes") && Array.isArray(n.gridColumnSizes)) {
      n.gridColumnSizes = n.gridColumnSizes.map(
        (entry) => entry.type === "FIXED" ? __spreadProps(__spreadValues({}, entry), { value: scale(entry.value, factor) }) : entry
      );
    }
  }

  // src/scale-appearance.ts
  function scaleCornerRadius(node, factor, canWrite) {
    if (!("cornerRadius" in node)) return;
    const n = node;
    if (n.cornerRadius !== figma.mixed) {
      if (canWrite("cornerRadius")) n.cornerRadius = scale(n.cornerRadius, factor);
    } else {
      if (canWrite("topLeftRadius")) n.topLeftRadius = scale(n.topLeftRadius, factor);
      if (canWrite("topRightRadius")) n.topRightRadius = scale(n.topRightRadius, factor);
      if (canWrite("bottomLeftRadius")) n.bottomLeftRadius = scale(n.bottomLeftRadius, factor);
      if (canWrite("bottomRightRadius")) n.bottomRightRadius = scale(n.bottomRightRadius, factor);
    }
  }
  function scaleStrokes(node, factor, canWrite) {
    if (!("strokeWeight" in node)) return;
    const n = node;
    if (n.strokeWeight !== figma.mixed) {
      if (canWrite("strokeWeight")) n.strokeWeight = scaleExact(n.strokeWeight, factor);
    } else {
      const in_ = n;
      if (canWrite("strokeTopWeight")) in_.strokeTopWeight = scaleExact(in_.strokeTopWeight, factor);
      if (canWrite("strokeBottomWeight")) in_.strokeBottomWeight = scaleExact(in_.strokeBottomWeight, factor);
      if (canWrite("strokeLeftWeight")) in_.strokeLeftWeight = scaleExact(in_.strokeLeftWeight, factor);
      if (canWrite("strokeRightWeight")) in_.strokeRightWeight = scaleExact(in_.strokeRightWeight, factor);
    }
    if ("dashPattern" in n && canWrite("dashPattern")) {
      n.dashPattern = n.dashPattern.map((v) => scaleExact(v, factor));
    }
  }
  function scaleEffectsDirect(node, factor, canWrite) {
    if (!("effects" in node)) return;
    if (!canWrite("effects")) return;
    if (isBoundToStyle(node, "effects")) return;
    const n = node;
    n.effects = n.effects.map((e) => scaleEffect(e, factor));
  }

  // src/scale-text.ts
  async function scaleTextProperties(node, factor, canWrite) {
    if (node.type !== "TEXT") return;
    if (isBoundToStyle(node, "textStyle")) return;
    const fonts = node.getRangeAllFontNames(0, node.characters.length);
    for (const font of fonts) {
      await figma.loadFontAsync(font);
    }
    const n = node;
    if (canWrite("fontSize")) {
      if (n.fontSize !== figma.mixed) {
        n.fontSize = scale(n.fontSize, factor);
      } else {
        const len = n.characters.length;
        for (let i = 0; i < len; ) {
          const size = n.getRangeFontSize(i, i + 1);
          let j = i + 1;
          while (j < len && n.getRangeFontSize(j, j + 1) === size) j++;
          if (typeof size === "number") {
            n.setRangeFontSize(i, j, scale(size, factor));
          }
          i = j;
        }
      }
    }
    if (canWrite("lineHeight")) {
      if (n.lineHeight !== figma.mixed) {
        const lh = n.lineHeight;
        if (lh.unit === "PIXELS") n.lineHeight = { unit: "PIXELS", value: scale(lh.value, factor) };
      } else {
        const len = n.characters.length;
        for (let i = 0; i < len; ) {
          const lh = n.getRangeLineHeight(i, i + 1);
          let j = i + 1;
          while (j < len) {
            const next = n.getRangeLineHeight(j, j + 1);
            if (JSON.stringify(next) !== JSON.stringify(lh)) break;
            j++;
          }
          if (lh.unit === "PIXELS") {
            n.setRangeLineHeight(i, j, { unit: "PIXELS", value: scale(lh.value, factor) });
          }
          i = j;
        }
      }
    }
    if (canWrite("letterSpacing")) {
      if (n.letterSpacing !== figma.mixed) {
        const ls = n.letterSpacing;
        if (ls.unit === "PIXELS") n.letterSpacing = { unit: "PIXELS", value: scale(ls.value, factor) };
      } else {
        const len = n.characters.length;
        for (let i = 0; i < len; ) {
          const ls = n.getRangeLetterSpacing(i, i + 1);
          let j = i + 1;
          while (j < len) {
            const next = n.getRangeLetterSpacing(j, j + 1);
            if (JSON.stringify(next) !== JSON.stringify(ls)) break;
            j++;
          }
          if (ls.unit === "PIXELS") {
            n.setRangeLetterSpacing(i, j, { unit: "PIXELS", value: scale(ls.value, factor) });
          }
          i = j;
        }
      }
    }
    if (canWrite("listSpacing") && typeof n.listSpacing === "number") {
      n.listSpacing = scale(n.listSpacing, factor);
    }
  }

  // src/scale-vector.ts
  function scaleVectorNode(node, factor, canWrite, anchor) {
    var _a, _b;
    const parent = node.parent;
    const isTopLevel = parent !== null && parent.type === "PAGE";
    const isAbsolute = "layoutPositioning" in node && node.layoutPositioning === "ABSOLUTE";
    const parentIsAutoLayout = parent !== null && "layoutMode" in parent && parent.layoutMode !== "NONE";
    const shouldScaleXY = !parentIsAutoLayout || isAbsolute;
    const constraints = "constraints" in node ? node.constraints : null;
    const hC = (_a = constraints == null ? void 0 : constraints.horizontal) != null ? _a : "MIN";
    const vC = (_b = constraints == null ? void 0 : constraints.vertical) != null ? _b : "MIN";
    if (hC === "SCALE" || vC === "SCALE") {
      const oldX = node.x;
      const oldY = node.y;
      const oldW = node.width;
      const oldH = node.height;
      const MIN_DIM = 0.01;
      const newW = Math.max(MIN_DIM, scaleExact(oldW, factor));
      const newH = Math.max(MIN_DIM, scaleExact(oldH, factor));
      node.resize(newW, newH);
      node.constraints = {
        horizontal: hC === "SCALE" ? "MIN" : hC,
        vertical: vC === "SCALE" ? "MIN" : vC
      };
      if (shouldScaleXY) {
        if ((hC === "SCALE" || hC === "MIN") && canWrite("x")) {
          node.x = isTopLevel ? anchor.x + (oldX - anchor.x) * factor : scaleExact(oldX, factor);
        }
        if ((vC === "SCALE" || vC === "MIN") && canWrite("y")) {
          node.y = isTopLevel ? anchor.y + (oldY - anchor.y) * factor : scaleExact(oldY, factor);
        }
        if (hC === "CENTER" && canWrite("x")) {
          node.x = oldX + (oldW - newW) / 2;
        }
        if (vC === "CENTER" && canWrite("y")) {
          node.y = oldY + (oldH - newH) / 2;
        }
      }
      scaleStrokes(node, factor, canWrite);
      return;
    }
    if (shouldScaleXY) {
      if ((hC === "MIN" || hC === "CENTER") && canWrite("x")) {
        node.x = isTopLevel ? anchor.x + (node.x - anchor.x) * factor : scaleExact(node.x, factor);
      }
      if ((vC === "MIN" || vC === "CENTER") && canWrite("y")) {
        node.y = isTopLevel ? anchor.y + (node.y - anchor.y) * factor : scaleExact(node.y, factor);
      }
    }
    if (hC === "CENTER" || vC === "CENTER") {
      node.constraints = {
        horizontal: hC === "CENTER" ? "MIN" : hC,
        vertical: vC === "CENTER" ? "MIN" : vC
      };
    }
    const hManual = hC !== "STRETCH" && canWrite("width");
    const vManual = vC !== "STRETCH" && canWrite("height");
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

  // src/scale-node.ts
  async function scaleNode(node, factor, overrideMap, anchor) {
    console.log(`[scaleNode] ${node.name} (${node.type})`);
    const isInstanceOrInsideInstance = node.type === "INSTANCE" || isDescendantOfInstance(node);
    const overriddenFields = overrideMap.get(node.id);
    function canWrite(field) {
      if (isBoundToVariable(node, field)) return false;
      if (isInstanceOrInsideInstance) {
        return overriddenFields ? overriddenFields.has(field) : false;
      }
      if (hasScaleConstraint(node, field)) return false;
      return true;
    }
    if (node.type === "GROUP") return;
    if (node.type === "BOOLEAN_OPERATION") return;
    if (node.type === "VECTOR") {
      scaleVectorNode(node, factor, canWrite, anchor);
      return;
    }
    if (node.type === "SECTION") {
      scalePosition(node, factor, canWrite, anchor);
      const s = node;
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
  function scalePosition(node, factor, canWrite, anchor) {
    if (!("x" in node && "y" in node)) return;
    const parent = node.parent;
    const isAbsolute = "layoutPositioning" in node && node.layoutPositioning === "ABSOLUTE";
    const parentIsAutoLayout = parent !== null && "layoutMode" in parent && parent.layoutMode !== "NONE";
    const parentIsGroup = parent !== null && parent.type === "GROUP";
    const groupParent = parentIsGroup ? parent.parent : null;
    const groupParentLayoutMode = groupParent !== null && "layoutMode" in groupParent ? groupParent.layoutMode : "NONE";
    const skipX = parentIsGroup && groupParentLayoutMode === "HORIZONTAL";
    const skipY = parentIsGroup && groupParentLayoutMode === "VERTICAL";
    const shouldScaleXY = !parentIsAutoLayout || isAbsolute;
    if (!shouldScaleXY) return;
    const isTopLevel = parent !== null && parent.type === "PAGE";
    const nodeConstraints = "constraints" in node ? node.constraints : null;
    if (!skipX && canWrite("x")) {
      const x = node.x;
      if (!isTopLevel && (nodeConstraints == null ? void 0 : nodeConstraints.horizontal) === "MAX" && parent !== null && "width" in parent) {
        const parentW = parent.width;
        const parentFixedW = "layoutSizingHorizontal" in parent && parent.layoutSizingHorizontal === "FIXED";
        const newParentW = parentFixedW ? scale(parentW, factor) : parentW;
        node.x = parentW - newParentW + scale(x, factor);
      } else {
        node.x = isTopLevel ? anchor.x + Math.round((x - anchor.x) * factor) : scale(x, factor);
      }
    }
    if (!skipY && canWrite("y")) {
      const y = node.y;
      if (!isTopLevel && (nodeConstraints == null ? void 0 : nodeConstraints.vertical) === "MAX" && parent !== null && "height" in parent) {
        const parentH = parent.height;
        const parentFixedH = "layoutSizingVertical" in parent && parent.layoutSizingVertical === "FIXED";
        const newParentH = parentFixedH ? scale(parentH, factor) : parentH;
        node.y = parentH - newParentH + scale(y, factor);
      } else {
        node.y = isTopLevel ? anchor.y + Math.round((y - anchor.y) * factor) : scale(y, factor);
      }
    }
  }
  function scaleSize(node, factor, canWrite) {
    if (!("layoutSizingHorizontal" in node)) return;
    const n = node;
    if (node.type === "TEXT") {
      const t = node;
      const autoResize = t.textAutoResize;
      if (autoResize === "WIDTH_AND_HEIGHT") return;
      if (autoResize === "HEIGHT") {
        if (n.layoutSizingHorizontal === "FIXED" && canWrite("width")) {
          n.resize(scale(n.width, factor), n.height);
          t.textAutoResize = "HEIGHT";
        }
        return;
      }
    }
    if (n.layoutSizingHorizontal === "FIXED" && canWrite("width")) {
      n.resize(scale(n.width, factor), n.height);
    }
    if (n.layoutSizingVertical === "FIXED" && canWrite("height")) {
      n.resize(n.width, scale(n.height, factor));
    }
  }

  // src/canvas-traversal.ts
  async function runStep4(factor, onPageProgress) {
    let totalNodes = 0;
    const pages = figma.root.children;
    const pageCount = pages.length;
    for (let i = 0; i < pageCount; i++) {
      const page = pages[i];
      onPageProgress(i + 1, pageCount, page.name);
      await yieldControl();
      const overrideMap = buildOverrideMap(page);
      const anchor = getPageAnchor(page);
      const count = await traverseBottomUp(page, factor, overrideMap, anchor);
      totalNodes += count;
      await yieldControl();
    }
    return { nodes: totalNodes, pages: pageCount };
  }
  async function runStep4Selection(factor) {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      throw new Error("Keine Nodes ausgew\xE4hlt.");
    }
    sendProgress(`Schritt 4 \u2014 Canvas \u2014 Auswahl (${selection.length} Nodes)\u2026`);
    await yieldControl();
    const overrideMap = buildOverrideMap(figma.currentPage);
    const anchor = getPageAnchor(figma.currentPage);
    let totalNodes = 0;
    for (const node of selection) {
      totalNodes += await traverseBottomUp(node, factor, overrideMap, anchor);
    }
    return { nodes: totalNodes, pages: 1 };
  }
  async function traverseBottomUp(node, factor, overrideMap, anchor) {
    let count = 0;
    if ("children" in node) {
      for (const child of node.children) {
        try {
          count += await traverseBottomUp(child, factor, overrideMap, anchor);
        } catch (err) {
          console.error(`[traverseBottomUp] skipped "${child.name}" (${child.type}):`, err);
        }
      }
    }
    if (node.type === "PAGE" || node.type === "DOCUMENT") return count;
    await scaleNode(node, factor, overrideMap, anchor);
    count++;
    return count;
  }
  function buildOverrideMap(root) {
    const map = /* @__PURE__ */ new Map();
    collectOverrides(root, map);
    return map;
  }
  function collectOverrides(node, map) {
    if (node.type === "INSTANCE") {
      for (const override of node.overrides) {
        if (!map.has(override.id)) {
          map.set(override.id, /* @__PURE__ */ new Set());
        }
        for (const field of override.overriddenFields) {
          map.get(override.id).add(field);
        }
      }
    }
    if ("children" in node) {
      for (const child of node.children) {
        collectOverrides(child, map);
      }
    }
  }
  function getPageAnchor(page) {
    const children = page.children;
    if (children.length === 0) return { x: 0, y: 0 };
    let minX = Infinity;
    let minY = Infinity;
    for (const child of children) {
      if ("x" in child && "y" in child) {
        minX = Math.min(minX, child.x);
        minY = Math.min(minY, child.y);
      }
    }
    return {
      x: minX === Infinity ? 0 : minX,
      y: minY === Infinity ? 0 : minY
    };
  }

  // src/main.ts
  figma.showUI(__html__, { width: 256, height: 320, title: "ScaleItAll" });
  figma.ui.onmessage = async (msg) => {
    var _a;
    if (msg.type !== "run") return;
    const factor = msg.factor;
    const steps = msg.steps;
    const selectionOnly = (_a = msg.selectionOnly) != null ? _a : false;
    let totalNodes = 0;
    let totalPages = 0;
    try {
      for (const step of steps) {
        switch (step) {
          case 1:
            sendProgress("Schritt 1 \u2014 Variables\u2026");
            await runStep1(factor);
            break;
          case 2:
            sendProgress("Schritt 2 \u2014 Text Styles\u2026");
            await runStep2(factor);
            break;
          case 3:
            sendProgress("Schritt 3 \u2014 Effect & Paint Styles\u2026");
            await runStep3(factor);
            break;
          case 4: {
            const result = selectionOnly ? await runStep4Selection(factor) : await runStep4(factor, (pageIndex, pageCount, pageName) => {
              sendProgress(`Schritt 4 \u2014 Canvas \u2014 Seite ${pageIndex} / ${pageCount}: ${pageName}`);
            });
            totalNodes += result.nodes;
            totalPages += result.pages;
            break;
          }
        }
      }
      const summary = steps.includes(4) ? `Fertig \u2014 ${totalPages} Seiten, ${totalNodes} Nodes skaliert` : `Fertig`;
      sendDone(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendError(`Fehler: ${message}`);
    }
  };
})();
