import React, { useEffect, useRef, useState } from 'react';

type SpeechOptions = { durationMs?: number; speedMsPerChar?: number };

export function SpeechBubble(props: {
  text: string;
  options?: SpeechOptions;
  onCopied?: (text: string) => void;
  onHidden?: () => void;
}) {
  const { text, options, onCopied, onHidden } = props;
  const [displayText, setDisplayText] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [opacity, setOpacity] = useState(0);
  const typingIndexRef = useRef(0);
  const typingTimerRef = useRef<number | null>(null);
  const fadeTimerRef = useRef<number | null>(null);
  const targetTextRef = useRef('');
  const optionsRef = useRef<{ durationMs: number; speedMsPerChar: number }>({
    durationMs: 60000,
    speedMsPerChar: 8,
  });

  useEffect(() => {
    if (typingTimerRef.current != null) window.clearInterval(typingTimerRef.current);
    if (fadeTimerRef.current != null) window.clearTimeout(fadeTimerRef.current);

    const durationMs = Math.max(1000, options?.durationMs ?? optionsRef.current.durationMs);
    const speedMsPerChar = Math.max(5, options?.speedMsPerChar ?? optionsRef.current.speedMsPerChar);
    optionsRef.current = { durationMs, speedMsPerChar };

    targetTextRef.current = text;
    typingIndexRef.current = 0;
    setDisplayText('');
    setIsVisible(true);
    setOpacity(1);

    typingTimerRef.current = window.setInterval(() => {
      const target = targetTextRef.current;
      const nextIndex = typingIndexRef.current + 1;
      typingIndexRef.current = nextIndex;
      setDisplayText(target.slice(0, nextIndex));

      if (nextIndex >= target.length) {
        if (typingTimerRef.current != null) window.clearInterval(typingTimerRef.current);
        fadeTimerRef.current = window.setTimeout(() => {
          setOpacity(0);
        }, durationMs);
      }
    }, speedMsPerChar);

    return () => {
      if (typingTimerRef.current != null) window.clearInterval(typingTimerRef.current);
      if (fadeTimerRef.current != null) window.clearTimeout(fadeTimerRef.current);
    };
  }, [text, options?.durationMs, options?.speedMsPerChar]);

  const copyTextToClipboard = async (value: string) => {
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(value);
        onCopied?.(value);
        return;
      }
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      onCopied?.(value);
    } catch {}
  };

  if (!isVisible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        bottom: '24px',
        transform: 'translateX(-50%)',
        maxWidth: '90%',
        background: 'rgba(0, 0, 0, 0.55)',
        color: '#fff',
        borderRadius: '16px',
        padding: '12px 16px',
        boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        fontSize: '12px',
        lineHeight: 1.2,
        opacity,
        transition: 'opacity 400ms ease',
        pointerEvents: 'auto',
        cursor: 'pointer'
      }}
      title="Click to copy"
      onTransitionEnd={() => {
        if (opacity === 0) {
          setIsVisible(false);
          setDisplayText('');
          onHidden?.();
        }
      }}
      onClick={() => {
        const value = targetTextRef.current || displayText;
        void copyTextToClipboard(value);
      }}
    >
      {displayText}
    </div>
  );
}


