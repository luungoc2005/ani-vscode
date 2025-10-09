import React from 'react';
import { FloatingControlButton } from './FloatingControlButton';

interface AudioUnlockButtonProps {
  enabled: boolean;
  onToggle: () => Promise<void> | void;
}

export function AudioUnlockButton({ enabled, onToggle }: AudioUnlockButtonProps) {
  const handleClick = async () => {
    try {
      await onToggle();
    } catch (error) {
      console.error('Failed to toggle audio context', error);
    }
  };

  const label = enabled ? 'Disable audio playback' : 'Enable audio playback';

  return (
    <FloatingControlButton onClick={handleClick} ariaLabel={label} title={label}>
      {enabled ? '🔊' : '🔇'}
    </FloatingControlButton>
  );
}
