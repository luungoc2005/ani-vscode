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

  // Expose global API for debug panel
  (window as any).getAvailableMotions = () => {
    try {
      const delegate = LAppDelegate.getInstance();
      // console.log('getAvailableMotions - delegate:', delegate);
      
      // Access the first subdelegate's Live2DManager
      if ((delegate as any)._subdelegates && (delegate as any)._subdelegates.getSize() > 0) {
        const subdelegate = (delegate as any)._subdelegates.at(0);
        // console.log('getAvailableMotions - subdelegate:', subdelegate);
        
        const manager = subdelegate.getLive2DManager();
        // console.log('getAvailableMotions - manager:', manager);
        
        const result = manager.getAvailableMotions();
        // console.log('getAvailableMotions - result:', result);
        return result;
      } else {
        console.warn('getAvailableMotions - No subdelegates available');
      }
    } catch (e) {
      console.error('Error getting available motions:', e);
    }
    return { motions: [], modelName: '' };
  };

  (window as any).playMotion = (group: string, index: number) => {
    try {
      console.log('playMotion called:', group, index);
      const delegate = LAppDelegate.getInstance();
      if ((delegate as any)._subdelegates && (delegate as any)._subdelegates.getSize() > 0) {
        const subdelegate = (delegate as any)._subdelegates.at(0);
        const manager = subdelegate.getLive2DManager();
        manager.playMotion(group, index);
        console.log('playMotion - Motion started successfully');
      }
    } catch (e) {
      console.error('Error playing motion:', e);
    }
  };

  return () => LAppDelegate.releaseInstance();
}


