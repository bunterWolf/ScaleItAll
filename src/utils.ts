// =============================================================================
// Scaling math & helpers
// =============================================================================

/** Standard pixel scale with minimum-1 rule */
export function scale(value: number, factor: number): number {
  const result = Math.round(value * factor);
  return value >= 1 ? Math.max(1, result) : result;
}

/** Scale without integer rounding (for vectors, gradient transforms) */
export function scaleExact(value: number, factor: number): number {
  return value * factor;
}

declare function setTimeout(fn: () => void, ms: number): number;

export function yieldControl(): Promise<void> {
  return new Promise(r => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Messaging helpers
// ---------------------------------------------------------------------------
export function sendProgress(text: string) {
  figma.ui.postMessage({ type: 'progress', text });
}
export function sendDone(text: string) {
  figma.ui.postMessage({ type: 'done', text });
}
export function sendError(text: string) {
  figma.ui.postMessage({ type: 'error', text });
}
