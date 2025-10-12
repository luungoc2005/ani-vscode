import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SpeechBubble } from '../components/SpeechBubble';
import { ThinkingDots } from '../components/ThinkingDots';
import { DebugPanel } from '../components/DebugPanel';
import { SetupGuide } from '../components/SetupGuide';
import { bootCubism } from '../viewer/boot';
import { LAppDelegate } from '../viewer/lappdelegate';
import { ModelSwitchButton } from '../components/ModelSwitchButton';
import { AudioUnlockButton } from '../components/AudioUnlockButton';
import { AudioUnlockHint } from '../components/AudioUnlockHint';
import { getVsCodeApi } from '../vscode';
import { prepareAudioForPlayback, type TtsAudioPayload } from '../audio/ttsAudio';

declare global {
  interface Window {
    setSpeechBubble?: (
      text: string,
      options?: { durationMs?: number; speedMsPerChar?: number },
      quickReplies?: string[]
    ) => void;
    startLipSyncFromUrl?: (url: string) => void;
    startLipSyncFromArrayBuffer?: (buffer: ArrayBuffer) => void;
  }
}



export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackGenerationRef = useRef(0);
  const [speechText, setSpeechText] = useState('');
  const [speechOptions, setSpeechOptions] = useState<{ durationMs?: number; speedMsPerChar?: number } | undefined>(undefined);
  const [dismissSpeech, setDismissSpeech] = useState(false);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [showSetupGuide, setShowSetupGuide] = useState(true); // Show initially while testing
  const [setupErrorMessage, setSetupErrorMessage] = useState<string | undefined>(undefined);
  const [isTestingConnection, setIsTestingConnection] = useState(true); // Start with testing state
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [hasEverUnlocked, setHasEverUnlocked] = useState(false);
  const vscodeApiRef = useRef(getVsCodeApi());
  const audioUnlockedRef = useRef(audioUnlocked);

  useEffect(() => {
    audioUnlockedRef.current = audioUnlocked;
  }, [audioUnlocked]);

  const getOrAcquireVsCodeApi = useCallback(() => {
    const api = vscodeApiRef.current ?? getVsCodeApi();
    if (api) {
      vscodeApiRef.current = api;
    }
    return api;
  }, []);

  const postAudioCapability = useCallback((canPlay: boolean) => {
    const vscode = getOrAcquireVsCodeApi();
    if (vscode) {
      vscode.postMessage({ type: 'audioCapability', canPlay });
    }
  }, [getOrAcquireVsCodeApi]);

  const ensureAudioContext = useCallback((): AudioContext | null => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  const stopAudioPlayback = useCallback(() => {
    try {
      sourceRef.current?.stop();
    } catch {}
    sourceRef.current?.disconnect();
    sourceRef.current = null;
  }, []);

  const cancelAudioPlayback = useCallback(() => {
    playbackGenerationRef.current += 1;
    stopAudioPlayback();
  }, [stopAudioPlayback]);

  const resumeAudioContext = useCallback(async (): Promise<boolean> => {
    const ctx = ensureAudioContext();
    if (!ctx) {
      setAudioUnlocked(false);
      audioUnlockedRef.current = false;
      return false;
    }
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch (error) {
        console.warn('Failed to resume audio context', error);
        setAudioUnlocked(false);
        audioUnlockedRef.current = false;
        return false;
      }
    }
    const running = ctx.state === 'running';
    setAudioUnlocked(running);
    audioUnlockedRef.current = running;
    return running;
  }, [ensureAudioContext]);

  const suspendAudioContext = useCallback(async () => {
    const ctx = audioContextRef.current;
    if (ctx && ctx.state === 'running') {
      try {
        await ctx.suspend();
      } catch (error) {
        console.warn('Failed to suspend audio context', error);
      }
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const dispose = bootCubism(containerRef.current);

    const playAudioPayload = async (payload: TtsAudioPayload, generation: number) => {
      if (!audioUnlockedRef.current) {
        return;
      }
      try {
        stopAudioPlayback();
        if (!(await resumeAudioContext())) {
          return;
        }
        const ctx = ensureAudioContext();
        if (!ctx) {
          return;
        }
        if (!audioUnlockedRef.current || generation !== playbackGenerationRef.current) {
          return;
        }
        const processed = await prepareAudioForPlayback(ctx, payload);
        if (!audioUnlockedRef.current || generation !== playbackGenerationRef.current) {
          return;
        }

        if (processed.lipSyncWav) {
          window.startLipSyncFromArrayBuffer?.(processed.lipSyncWav);
        } else {
          window.startLipSyncFromUrl?.(`data:${payload.mimeType ?? 'audio/wav'};base64,${payload.data}`);
        }

        const source = ctx.createBufferSource();
        source.buffer = processed.playbackBuffer;
        source.playbackRate.value = 1;

        source.connect(ctx.destination);

        sourceRef.current = source;
        source.addEventListener('ended', () => {
          stopAudioPlayback();
        });

        if (!audioUnlockedRef.current || generation !== playbackGenerationRef.current) {
          stopAudioPlayback();
          return;
        }

        source.start();
      } catch (error) {
        console.error('Failed to play TTS audio', error);
        stopAudioPlayback();
      }
    };

    // Two-mode gaze control: caret-follow and mouse-follow with auto-switching
    let mode: 'mouse' | 'caret' = 'mouse';
    let caretTimeout: number | null = null;
    let lastPointerX = 0;
    let lastPointerY = 0;

    const showSpeech = (
      text: string,
      options?: { durationMs?: number; speedMsPerChar?: number },
      quickRepliesPayload?: string[]
    ) => {
      setSpeechText(text);
      setSpeechOptions(options);
      setDismissSpeech(false);
      setTtsError(null);
      setQuickReplies(Array.isArray(quickRepliesPayload) ? quickRepliesPayload.filter((item) => typeof item === 'string' && item.trim().length > 0) : []);
      setShowQuickReplies(false);
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
        cancelAudioPlayback();
        const currentGeneration = playbackGenerationRef.current;
        showSpeech(
          data.text,
          data.options,
          Array.isArray(data.quickReplies) ? data.quickReplies : undefined
        );
        if (data.audio && typeof data.audio.data === 'string') {
          void playAudioPayload(data.audio, currentGeneration);
        }
      } else if (data.type === 'dismissSpeech') {
        cancelAudioPlayback();
        setDismissSpeech(true);
        setShowQuickReplies(false);
        setQuickReplies([]);
      } else if (data.type === 'ttsError') {
        if (data.clear) {
          setTtsError(null);
        } else if (typeof data.message === 'string') {
          setTtsError(data.message);
          console.warn('Ani VSCode TTS error:', data.message);
        }
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
          const vscode = getOrAcquireVsCodeApi();
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
      cancelAudioPlayback();
      dispose?.();
      window.removeEventListener('message', onMessage);
      document.removeEventListener('pointermove', onPointerMove);
      if (caretTimeout != null) {
        window.clearTimeout(caretTimeout);
      }
      // Clean up global function
      window.setSpeechBubble = undefined;
    };
  }, [cancelAudioPlayback, ensureAudioContext, getOrAcquireVsCodeApi, resumeAudioContext, stopAudioPlayback]);

  const handleToggleAudio = useCallback(async () => {
    if (audioUnlocked) {
      cancelAudioPlayback();
      audioUnlockedRef.current = false;
      setAudioUnlocked(false);
      await suspendAudioContext();
      return;
    }

    const canPlay = await resumeAudioContext();
    audioUnlockedRef.current = canPlay;
    if (!canPlay) {
      setAudioUnlocked(false);
    }
  }, [audioUnlocked, cancelAudioPlayback, resumeAudioContext, suspendAudioContext]);

  useEffect(() => {
    if (audioUnlocked && !hasEverUnlocked) {
      setHasEverUnlocked(true);
    }
    postAudioCapability(audioUnlocked);
  }, [audioUnlocked, hasEverUnlocked, postAudioCapability]);

  const handleRetryConnection = () => {
    setIsTestingConnection(true);
    const vscode = getOrAcquireVsCodeApi();
    if (vscode) {
      vscode.postMessage({ type: 'retryConnection' });
    }
  };

  const handleDismissSetupGuide = () => {
    setShowSetupGuide(false);
  };

  const handleQuickReplySelected = useCallback((reply: string) => {
    const trimmed = reply.trim();
    if (!trimmed) {
      return;
    }
    const vscode = getOrAcquireVsCodeApi();
    if (vscode) {
      vscode.postMessage({ type: 'quickReplySelected', text: trimmed });
    }
    setShowQuickReplies(false);
  }, [getOrAcquireVsCodeApi]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div style={{ width: '100%', height: '100%' }} ref={containerRef} />
      <ThinkingDots visible={isThinking && !showSetupGuide} />
      {speechText && !showSetupGuide && (
        <SpeechBubble
          text={speechText}
          options={speechOptions}
          dismiss={dismissSpeech}
          quickReplies={quickReplies}
          showQuickReplies={showQuickReplies}
          onQuickReplySelected={handleQuickReplySelected}
          onHidden={() => {
            setSpeechText('');
            setDismissSpeech(false);
            setQuickReplies([]);
            setShowQuickReplies(false);
          }}
          onTypingComplete={() => {
            if (quickReplies.length > 0) {
              setShowQuickReplies(true);
            }
          }}
        />
      )}
      <div
        style={{
          position: 'absolute',
          left: '10vw',
          top: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          zIndex: 15,
        }}
      >
        <ModelSwitchButton />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AudioUnlockButton enabled={audioUnlocked} onToggle={handleToggleAudio} />
          {!hasEverUnlocked && !audioUnlocked && <AudioUnlockHint />}
        </div>
      </div>
      <DebugPanel visible={showDebugPanel} />
      <SetupGuide
        visible={showSetupGuide}
        errorMessage={setupErrorMessage}
        onRetry={handleRetryConnection}
        onDismiss={handleDismissSetupGuide}
        isTesting={isTestingConnection}
      />
      {ttsError && !showSetupGuide && (
        <div
          style={{
            position: 'absolute',
            right: 16,
            bottom: 16,
            maxWidth: 320,
            padding: '12px 16px',
            borderRadius: 8,
            background: 'rgba(128,0,0,0.88)',
            color: '#fff',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
            fontSize: 12,
            lineHeight: 1.4,
            zIndex: 20,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Speech playback unavailable</div>
          <div>{ttsError}</div>
          <button
            onClick={() => setTtsError(null)}
            style={{
              marginTop: 8,
              background: 'rgba(255,255,255,0.15)',
              color: '#fff',
              border: 'none',
              padding: '4px 10px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}


