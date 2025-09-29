import React, { useEffect, useRef, useState } from 'react';

export function ThinkingDots(props: { visible: boolean; label?: string }) {
  const { visible, label = 'Thinking' } = props;
  const [dots, setDots] = useState('');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!visible) {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
      timerRef.current = null;
      setDots('');
      return;
    }
    const sequence = ['', '.', '..', '...'];
    let idx = 0;
    timerRef.current = window.setInterval(() => {
      idx = (idx + 1) % sequence.length;
      setDots(sequence[idx]);
    }, 400);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '12px',
        right: '10vw',
        background: 'rgba(0, 0, 0, 0.55)',
        color: '#fff',
        borderRadius: '9999px',
        padding: '6px 10px',
        boxShadow: '0 6px 14px rgba(0,0,0,0.3)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        fontSize: '12px',
        lineHeight: 1,
        opacity: 0.95,
        userSelect: 'none',
      }}
      aria-label={label}
    >
      {`...${dots}`}
    </div>
  );
}


