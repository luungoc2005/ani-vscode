import React, { useEffect, useRef } from 'react';
import { bootCubism } from '../viewer/boot';
import { LAppDelegate } from '../viewer/lappdelegate';

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const dispose = bootCubism(containerRef.current);

    // Two-mode gaze control: caret-follow and mouse-follow with auto-switching
    let mode: 'mouse' | 'caret' = 'mouse';
    let caretTimeout: number | null = null;
    let lastPointerX = 0;
    let lastPointerY = 0;

    const onMessage = (ev: MessageEvent) => {
      const data = ev?.data as any;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'caret' && typeof data.x === 'number' && typeof data.y === 'number') {
        mode = 'caret';
        // Stick near the edge toward the editor side, but allow slight horizontal motion.
        // Use a small blend so caret X contributes within a narrow band near the edge.
        let nx = data.x;
        const edgeBlend = 0.2; // 0..1 range width near the edge
        if (data.side === 'left') {
          // Map full range [0..1] into [0..edgeBlend]
          nx = Math.max(0, Math.min(edgeBlend, data.x * edgeBlend));
        } else if (data.side === 'right') {
          // Map full range [0..1] into [1-edgeBlend .. 1]
          nx = 1 - Math.max(0, Math.min(edgeBlend, (1 - data.x) * edgeBlend));
        }
        // Drive gaze to caret normalized position
        try {
          LAppDelegate.getInstance().pointMovedNormalized(nx, data.y);
        } catch {}
        if (caretTimeout != null) {
          window.clearTimeout(caretTimeout);
        }
        // Revert back to mouse after inactivity
        caretTimeout = window.setTimeout(() => {
          mode = 'mouse';
        }, 1500);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      const dist2 = dx * dx + dy * dy;
      // Significant movement switches to mouse-follow
      if (dist2 > 400) {
        mode = 'mouse';
      }
      // In mouse mode, the built-in pointer handlers already drive gaze
    };

    window.addEventListener('message', onMessage);
    document.addEventListener('pointermove', onPointerMove, { passive: true });

    return () => dispose?.();
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }} ref={containerRef} />
  );
}


