import React, { useEffect, useRef, useState, useMemo } from 'react';
import MarkdownIt from 'markdown-it';

type SpeechOptions = { durationMs?: number; speedMsPerChar?: number };

export function SpeechBubble(props: {
  text: string;
  options?: SpeechOptions;
  dismiss?: boolean;
  onCopied?: (text: string) => void;
  onHidden?: () => void;
}) {
  const { text, options, dismiss, onCopied, onHidden } = props;
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

  // Create markdown-it instance
  const md = useMemo(() => {
    return new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      breaks: true,
    });
  }, []);

  // Render markdown to HTML
  const renderedHtml = useMemo(() => {
    return md.render(displayText);
  }, [displayText, md]);

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

  // Handle dismiss prop
  useEffect(() => {
    if (dismiss) {
      // Clear any ongoing timers
      if (typingTimerRef.current != null) window.clearInterval(typingTimerRef.current);
      if (fadeTimerRef.current != null) window.clearTimeout(fadeTimerRef.current);
      
      // Immediately fade out
      setOpacity(0);
    }
  }, [dismiss]);

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
        bottom: '24px',
        maxWidth: '100%',
        margin: '0 12vw',
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
      <div
        dangerouslySetInnerHTML={{ __html: renderedHtml }}
        style={{
          margin: 0,
          padding: 0,
        }}
        className="markdown-content"
      />
      <style>{`
        .markdown-content p {
          margin: 0.5em 0;
        }
        .markdown-content p:first-child {
          margin-top: 0;
        }
        .markdown-content p:last-child {
          margin-bottom: 0;
        }
        .markdown-content code {
          background: rgba(255, 255, 255, 0.1);
          padding: 2px 4px;
          border-radius: 3px;
          font-family: 'Courier New', monospace;
          font-size: 0.9em;
        }
        .markdown-content pre {
          background: rgba(255, 255, 255, 0.1);
          padding: 8px;
          border-radius: 4px;
          overflow-x: auto;
          margin: 0.5em 0;
        }
        .markdown-content pre code {
          background: none;
          padding: 0;
        }
        .markdown-content a {
          color: #6cc6ff;
          text-decoration: none;
        }
        .markdown-content a:hover {
          text-decoration: underline;
        }
        .markdown-content strong {
          font-weight: bold;
        }
        .markdown-content em {
          font-style: italic;
        }
        .markdown-content ul, .markdown-content ol {
          margin: 0.5em 0;
          padding-left: 1.5em;
        }
        .markdown-content li {
          margin: 0.25em 0;
        }
        .markdown-content blockquote {
          border-left: 3px solid rgba(255, 255, 255, 0.3);
          margin: 0.5em 0;
          padding-left: 0.8em;
          font-style: italic;
        }
        .markdown-content h1, .markdown-content h2, .markdown-content h3,
        .markdown-content h4, .markdown-content h5, .markdown-content h6 {
          margin: 0.8em 0 0.4em 0;
          font-weight: bold;
        }
        .markdown-content h1:first-child, .markdown-content h2:first-child,
        .markdown-content h3:first-child, .markdown-content h4:first-child,
        .markdown-content h5:first-child, .markdown-content h6:first-child {
          margin-top: 0;
        }
      `}</style>
    </div>
  );
}


