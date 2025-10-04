import React, { useEffect, useRef, useState } from 'react';
import { SpeechBubble } from '../components/SpeechBubble';
import { ThinkingDots } from '../components/ThinkingDots';
import { DebugPanel } from '../components/DebugPanel';
import { SetupGuide } from '../components/SetupGuide';
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
  const [dismissSpeech, setDismissSpeech] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(true); // Show initially while testing
  const [setupErrorMessage, setSetupErrorMessage] = useState<string | undefined>(undefined);
  const [isTestingConnection, setIsTestingConnection] = useState(true); // Start with testing state

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
      setDismissSpeech(false);
    };

    // Expose global function for programmatic control
    window.setSpeechBubble = showSpeech;

    const startThinking = () => setIsThinking(true);
    const stopThinking = () => setIsThinking(false);

    // Read debug panel setting from data attribute
    const debugPanelEnabled = document.body?.getAttribute('data-debug-panel') === 'true';
    setShowDebugPanel(debugPanelEnabled);

    const normalizeFileName = (value?: string) => value?.split('/').pop()?.toLowerCase();
    const normalizeKey = (value?: string) => value ? value.replace(/[\s_\-]+/g, '').toLowerCase() : undefined;

    const playEmotion = (payload: { fileName: string; emotion?: string; targetType?: 'motion' | 'expression' }) => {
      if (!(window as any).getAvailableMotions) {
        console.warn('playEmotion - getAvailableMotions missing');
        return;
      }

      const data = (window as any).getAvailableMotions();
      if (!data) {
        return;
      }

      const { motions = [], expressions = [] } = data;
      const targetFile = normalizeFileName(payload.fileName);
      const emotionHint = normalizeKey(payload.emotion);

      const motionMatch = motions.find((motion: any) => normalizeFileName(motion.fileName) === targetFile);

      let played = false;

      if (payload.targetType !== 'expression' && motionMatch && (window as any).playMotion) {
        (window as any).playMotion(motionMatch.group, motionMatch.index);
        played = true;
      }

      if (!played) {
        const expressionMatch = expressions.find((expression: any) => {
          const byFile = targetFile && normalizeFileName(expression.fileName) === targetFile;
          if (byFile) {
            return true;
          }
          if (emotionHint && expression.name) {
            const expressionKey = normalizeKey(expression.name);
            if (expressionKey === emotionHint) {
              return true;
            }
          }
          return false;
        });

        if (expressionMatch && (window as any).playExpression) {
          (window as any).playExpression(expressionMatch.name);
          played = true;
        }
      }

      if (!played && motionMatch && (window as any).playMotion) {
        // As a final fallback, try playing the motion even if targetType was expression
        (window as any).playMotion(motionMatch.group, motionMatch.index);
        played = true;
      }

      if (!played) {
        console.warn('playEmotion - No matching emotion asset found for', payload);
      }
    };

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
      } else if (data.type === 'dismissSpeech') {
        setDismissSpeech(true);
      } else if (data.type === 'thinking' && typeof data.on === 'boolean') {
        if (data.on) startThinking();
        else stopThinking();
      } else if (data.type === 'toggleDebugPanel') {
        setShowDebugPanel((prev) => !prev);
      } else if (data.type === 'setDebugPanel' && typeof data.visible === 'boolean') {
        setShowDebugPanel(data.visible);
      } else if ((data.type === 'playEmotion' || data.type === 'playMotionByFileName') && typeof data.fileName === 'string') {
        playEmotion({ fileName: data.fileName, emotion: data.emotion, targetType: data.targetType });
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
      } else if (data.type === 'setupError' && typeof data.message === 'string') {
        // Show setup guide when there's a connection error
        setSetupErrorMessage(data.message);
        setShowSetupGuide(true);
        setIsTestingConnection(false);
        // Hide thinking indicator
        setIsThinking(false);
      } else if (data.type === 'connectionSuccess') {
        // Hide setup guide on successful connection
        setShowSetupGuide(false);
        setSetupErrorMessage(undefined);
        setIsTestingConnection(false);
      } else if (data.type === 'testingConnection' && typeof data.testing === 'boolean') {
        // Update testing state
        setIsTestingConnection(data.testing);
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
      window.removeEventListener('message', onMessage);
      document.removeEventListener('pointermove', onPointerMove);
      if (caretTimeout != null) {
        window.clearTimeout(caretTimeout);
      }
      // Clean up global function
      window.setSpeechBubble = undefined;
    };
  }, []);

  const handleRetryConnection = () => {
    setIsTestingConnection(true);
    const vscode = (window as any).acquireVsCodeApi?.();
    if (vscode) {
      vscode.postMessage({ type: 'retryConnection' });
    }
  };

  const handleDismissSetupGuide = () => {
    setShowSetupGuide(false);
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{ width: '100%', height: '100%' }} ref={containerRef} />
      <ThinkingDots visible={isThinking && !showSetupGuide} />
      {speechText && !showSetupGuide && (
        <SpeechBubble
          text={speechText}
          options={speechOptions}
          dismiss={dismissSpeech}
          onHidden={() => {
            setSpeechText('');
            setDismissSpeech(false);
          }}
        />
      )}
      <ModelSwitchButton />
      <DebugPanel visible={showDebugPanel} />
      <SetupGuide
        visible={showSetupGuide}
        errorMessage={setupErrorMessage}
        onRetry={handleRetryConnection}
        onDismiss={handleDismissSetupGuide}
        isTesting={isTestingConnection}
      />
    </div>
  );
}


