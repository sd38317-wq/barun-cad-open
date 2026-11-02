import {alignRasterView} from './gpu-render-protocol.js';

// Experimental asynchronous rendering must never pick against an unseen camera.
export function gpuViewPending(stats, view) {
  if (!stats.enabled || stats.reason || stats.backend !== 'MLightCAD Worker') return false;
  view=alignRasterView(view);
  const shown = stats.displayedView;
  return !!stats.viewPending || !shown || stats.displayedDoc !== view.doc || stats.displayedRevision !== view.revision || shown.scale !== view.scale ||
    shown.width !== view.width || shown.height !== view.height ||
    shown.origin.x !== view.origin.x || shown.origin.y !== view.origin.y;
}
