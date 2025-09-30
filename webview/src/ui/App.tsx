import React, { useEffect, useRef, useState } from 'react';
import { SpeechBubble } from '../components/SpeechBubble';
import { ThinkingDots } from '../components/ThinkingDots';
import { DebugPanel } from '../components/DebugPanel';
import { bootCubism } from '../viewer/boot';
import { LAppDelegate } from '../viewer/lappdelegate';
import { ModelSwitchButton } from '../components/ModelSwitchButton';

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
  const [speechText, setSpeechText] = useState('');
  const [speechOptions, setSpeechOptions] = useState<{ durationMs?: number; speedMsPerChar?: number } | undefined>(undefined);
  const [isThinking, setIsThinking] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  const copyTextToClipboard = async (_text: string) => {};

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
      setSpeechText(text);
      setSpeechOptions(options);
    };

    // Expose global function for programmatic control
    window.setSpeechBubble = showSpeech;

    const startThinking = () => setIsThinking(true);
    const stopThinking = () => setIsThinking(false);

    // Read debug panel setting from data attribute
    const debugPanelEnabled = document.body?.getAttribute('data-debug-panel') === 'true';
    setShowDebugPanel(debugPanelEnabled);

    const onMessage = (ev: MessageEvent) => {
      const data = ev?.data as any;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'caret' && typeof data.x === 'number' && typeof data.y === 'number') {
        mode = 'caret';
        let nx = data.x;
        const edgeBlend = 0.5; // 0..1 range width near the edge (increased for stronger following)
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
      } else if (data.type === 'thinking' && typeof data.on === 'boolean') {
        if (data.on) startThinking();
        else stopThinking();
      } else if (data.type === 'toggleDebugPanel') {
        setShowDebugPanel((prev) => !prev);
      } else if (data.type === 'setDebugPanel' && typeof data.visible === 'boolean') {
        setShowDebugPanel(data.visible);
      } else if (data.type === 'playMotionByFileName' && typeof data.fileName === 'string') {
        // Get current model's motions and find the one matching fileName
        if ((window as any).getAvailableMotions && (window as any).playMotion) {
          const motionsData = (window as any).getAvailableMotions();
          const motion = motionsData.motions?.find((m: any) => m.fileName === data.fileName);
          if (motion) {
            (window as any).playMotion(motion.group, motion.index);
          }
        }
      } else if (data.type === 'getCurrentModel') {
        // Respond with current model name
        if ((window as any).getAvailableMotions) {
          const motionsData = (window as any).getAvailableMotions();
          const vscode = (window as any).acquireVsCodeApi?.();
          if (vscode) {
            vscode.postMessage({
              type: 'currentModel',
              modelName: motionsData.modelName || 'Hiyori',
            });
          }
        }
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
    // showSpeech('Hello World');

    return () => {
      dispose?.();
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{ width: '100%', height: '100%' }} ref={containerRef} />
      <ThinkingDots visible={isThinking} />
      {speechText && (
        <SpeechBubble
          text={speechText}
          options={speechOptions}
          onHidden={() => setSpeechText('')}
        />
      )}
      <ModelSwitchButton />
      <DebugPanel visible={showDebugPanel} />
    </div>
  );
}


