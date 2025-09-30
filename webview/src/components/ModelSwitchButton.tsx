import React from 'react';
import { LAppDelegate } from '../viewer/lappdelegate';

export function ModelSwitchButton() {
  const onClick = () => {
    try {
      LAppDelegate.getInstance().nextScene();
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title="Switch character"
      aria-label="Switch character"
      style={{
        position: 'absolute',
        left: '10vw',
        top: '12px',
        width: '34px',
        height: '34px',
        borderRadius: '9999px',
        background: 'rgba(0, 0, 0, 0.55)',
        color: '#fff',
        border: 'none',
        boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        fontSize: '18px',
        lineHeight: 1,
        cursor: 'pointer',
        userSelect: 'none'
      }}
    >
      ⭐
    </button>
  );
}


