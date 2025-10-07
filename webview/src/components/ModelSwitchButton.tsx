import React from 'react';
import { LAppDelegate } from '../viewer/lappdelegate';
import { FloatingControlButton } from './FloatingControlButton';
import { getVsCodeApi } from '../vscode';

const vscodeApi = getVsCodeApi();

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
    <FloatingControlButton
      onClick={onClick}
      ariaLabel="Switch character"
      title="Switch character"
    >
      ⭐
    </FloatingControlButton>
  );
}


