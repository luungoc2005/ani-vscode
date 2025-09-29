import React, { useEffect, useRef, useState } from 'react';
import { bootCubism } from '../viewer/boot';
import { LAppDelegate } from '../viewer/lappdelegate';

declare global {
  interface Window {
    setSpeechBubble?: (
      text: string,
      options?: { durationMs?: number; speedMsPerChar?: number }
    ) => void;
  }
}

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [displayText, setDisplayText] = useState('');
  const typingIndexRef = useRef(0);
  const typingTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [opacity, setOpacity] = useState(0);
  const currentTargetTextRef = useRef('');
  const currentOptionsRef = useRef<{ durationMs: number; speedMsPerChar: number }>({
    durationMs: 3000,
    speedMsPerChar: 35
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const dispose = bootCubism(containerRef.current);

    // Two-mode gaze control: caret-follow and mouse-follow with auto-switching
    let mode: 'mouse' | 'caret' = 'mouse';
    let caretTimeout: number | null = null;
    let lastPointerX = 0;
    let lastPointerY = 0;

    const showSpeech = (
      text: string,
      options?: { durationMs?: number; speedMsPerChar?: number }
    ) => {
      // Clear previous timers
      if (typingTimerRef.current != null) window.clearInterval(typingTimerRef.current);
      if (fadeTimerRef.current != null) window.clearTimeout(fadeTimerRef.current);

      const durationMs = Math.max(1000, options?.durationMs ?? currentOptionsRef.current.durationMs);
      const speedMsPerChar = Math.max(5, options?.speedMsPerChar ?? currentOptionsRef.current.speedMsPerChar);
      currentOptionsRef.current = { durationMs, speedMsPerChar };

      currentTargetTextRef.current = text;
      typingIndexRef.current = 0;
      setDisplayText('');
      setIsVisible(true);
      setOpacity(1);

      typingTimerRef.current = window.setInterval(() => {
        const target = currentTargetTextRef.current;
        const nextIndex = typingIndexRef.current + 1;
        typingIndexRef.current = nextIndex;
        setDisplayText(target.slice(0, nextIndex));

        if (nextIndex >= target.length) {
          if (typingTimerRef.current != null) window.clearInterval(typingTimerRef.current);
          // Schedule fade out
          fadeTimerRef.current = window.setTimeout(() => {
            setOpacity(0);
          }, durationMs);
        }
      }, currentOptionsRef.current.speedMsPerChar);
    };

    // Expose global function for programmatic control
    window.setSpeechBubble = showSpeech;

    const onMessage = (ev: MessageEvent) => {
      const data = ev?.data as any;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'caret' && typeof data.x === 'number' && typeof data.y === 'number') {
        mode = 'caret';
        let nx = data.x;
        const edgeBlend = 0.2; // 0..1 range width near the edge
        if (data.side === 'left') {
          nx = Math.max(0, Math.min(edgeBlend, data.x * edgeBlend));
        } else if (data.side === 'right') {
          nx = 1 - Math.max(0, Math.min(edgeBlend, (1 - data.x) * edgeBlend));
        }
        try {
          LAppDelegate.getInstance().pointMovedNormalized(nx, data.y);
        } catch {}
        if (caretTimeout != null) {
          window.clearTimeout(caretTimeout);
        }
        caretTimeout = window.setTimeout(() => {
          mode = 'mouse';
        }, 1500);
      } else if (data.type === 'speech' && typeof data.text === 'string') {
        showSpeech(data.text, data.options);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      const dist2 = dx * dx + dy * dy;
      if (dist2 > 400) {
        mode = 'mouse';
      }
    };

    window.addEventListener('message', onMessage);
    document.addEventListener('pointermove', onPointerMove, { passive: true });

    // Show default message
    showSpeech('Hello World');

    return () => {
      if (typingTimerRef.current != null) window.clearInterval(typingTimerRef.current);
      if (fadeTimerRef.current != null) window.clearTimeout(fadeTimerRef.current);
      dispose?.();
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{ width: '100%', height: '100%' }} ref={containerRef} />
      {isVisible && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '24px',
            transform: 'translateX(-50%)',
            maxWidth: '80%',
            background: 'rgba(0, 0, 0, 0.55)',
            color: '#fff',
            borderRadius: '16px',
            padding: '12px 16px',
            boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
            fontSize: '14px',
            lineHeight: 1.4,
            opacity,
            transition: 'opacity 400ms ease',
            pointerEvents: 'none'
          }}
          onTransitionEnd={() => {
            if (opacity === 0) {
              setIsVisible(false);
              setDisplayText('');
            }
          }}
        >
          {displayText}
        </div>
      )}
    </div>
  );
}


