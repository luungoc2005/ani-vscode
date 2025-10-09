import React, { useEffect, useState } from 'react';

interface AudioUnlockHintProps {
  message?: string;
  durationMs?: number;
}

const HINT_STYLE: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  background: 'rgba(20, 20, 30, 0.82)',
  color: '#fff',
  fontSize: 11,
  lineHeight: 1.4,
  maxWidth: 240,
  boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
  pointerEvents: 'none',
  transition: 'opacity 400ms ease',
  opacity: 1,
};

export function AudioUnlockHint({ message = 'Click to enable audio playback.', durationMs = 10000 }: AudioUnlockHintProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    if (!durationMs || durationMs <= 0) {
      return;
    }

    const fadeTimer = window.setTimeout(() => {
      setIsFadingOut(true);
    }, durationMs);

    return () => {
      window.clearTimeout(fadeTimer);
    };
  }, [durationMs]);

  useEffect(() => {
    if (!isFadingOut) {
      return;
    }

    const hideTimer = window.setTimeout(() => {
      setIsVisible(false);
    }, 400);

    return () => {
      window.clearTimeout(hideTimer);
    };
  }, [isFadingOut]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      style={{
        ...HINT_STYLE,
        opacity: isFadingOut ? 0 : 1,
      }}
    >
      {message}
    </div>
  );
}
