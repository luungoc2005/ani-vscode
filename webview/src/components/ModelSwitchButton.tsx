import React from 'react';
import { LAppDelegate } from '../viewer/lappdelegate';

declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage: (message: any) => void;
    };
  }
}

// Acquire vscode API once at module load time
const vscodeApi = typeof window !== 'undefined' && window.acquireVsCodeApi ? window.acquireVsCodeApi() : null;

export function ModelSwitchButton() {
  const onClick = () => {
    try {
      // Switch to the next character model
      LAppDelegate.getInstance().nextScene();
      
      // Wait for the model to load before getting the character name
      // The scene change is asynchronous, so we need to wait a bit
      setTimeout(() => {
        try {
          // Get the current model name after switching
          const modelInfo = (window as any).getAvailableMotions?.();
          const characterName = modelInfo?.modelName || 'Hiyori';
          
          // Send message to the extension using the cached API
          if (vscodeApi) {
            vscodeApi.postMessage({
              type: 'characterChanged',
              characterName: characterName,
            });
          }
        } catch (err) {
          console.error('Error switching character:', err);
        }
      }, 200);
    } catch (err) {
      console.error('Error switching character:', err);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title="Switch character"
      aria-label="Switch character"
      style={{
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
        userSelect: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      ⭐
    </button>
  );
}


