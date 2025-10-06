import React from 'react';
import { FloatingControlButton } from './FloatingControlButton';

interface AudioUnlockButtonProps {
  onUnlock: () => Promise<void>;
}

export function AudioUnlockButton({ onUnlock }: AudioUnlockButtonProps) {
  const handleClick = async () => {
    try {
      await onUnlock();
    } catch (error) {
      console.error('Failed to unlock audio context', error);
    }
  };

  return (
    <FloatingControlButton
      onClick={handleClick}
      ariaLabel="Enable audio playback"
      title="Enable audio playback"
    >
      🎵
    </FloatingControlButton>
  );
}
