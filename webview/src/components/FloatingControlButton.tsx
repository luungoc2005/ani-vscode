import React from 'react';

const BASE_STYLE: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: '9999px',
  background: 'rgba(0, 0, 0, 0.55)',
  color: '#fff',
  border: 'none',
  boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
  fontSize: 18,
  lineHeight: 1,
  cursor: 'pointer',
  userSelect: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

interface FloatingControlButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  ariaLabel: string;
  title?: string;
  children: React.ReactNode;
}

export function FloatingControlButton({
  ariaLabel,
  title,
  children,
  style,
  type,
  ...rest
}: FloatingControlButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      {...rest}
      style={{ ...BASE_STYLE, ...style }}
    >
      {children}
    </button>
  );
}
