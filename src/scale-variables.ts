// =============================================================================
// Step 1 — Variables (FLOAT only)
// =============================================================================

import { scale } from './utils';

export async function runStep1(factor: number): Promise<void> {
  const localVars = await figma.variables.getLocalVariablesAsync('FLOAT');
  for (const variable of localVars) {
    for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
      if (typeof value === 'number') {
        variable.setValueForMode(modeId, scale(value, factor));
      }
    }
  }
}
