import { LAppDelegate } from './lappdelegate';
import * as LAppDefine from './lappdefine';

export function bootCubism(container: HTMLElement) {
  // Create a canvas and append to the container. We'll mimic the demo behavior.
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  // Ensure the canvas doesn't paint an opaque background
  const wantsTransparent =
    (typeof document !== 'undefined' &&
      document.body?.getAttribute('data-transparent-background') === 'true') ||
    false;
  if (wantsTransparent) {
    canvas.style.background = 'transparent';
  }
  container.appendChild(canvas);

  // Initialize and run the Cubism app
  const app = LAppDelegate.getInstance();
  app.initialize({ canvasOverride: canvas });
  app.run();

  return () => LAppDelegate.releaseInstance();
}


