// =============================================================================
// ScaleItAll — Plugin Entry Point (Figma Sandbox)
// =============================================================================

import { sendProgress, sendDone, sendError } from './utils';
import { runStep1 } from './scale-variables';
import { runStep2 } from './scale-text-styles';
import { runStep3 } from './scale-effect-paint-styles';
import { runStep4, runStep4Selection } from './canvas-traversal';

figma.showUI(__html__, { width: 256, height: 320, title: 'ScaleItAll' });

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
