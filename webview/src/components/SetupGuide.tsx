import React from 'react';

interface SetupGuideProps {
  visible: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  isTesting?: boolean;
}

export function SetupGuide(props: SetupGuideProps) {
  const { visible, errorMessage, onRetry, onDismiss, isTesting } = props;

  if (!visible) return null;

  const openSettings = () => {
    const vscode = (window as any).acquireVsCodeApi?.();
    if (vscode) {
      vscode.postMessage({ type: 'openSettings' });
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px',
      }}
    >
      <div
        style={{
          backgroundColor: 'rgba(30, 30, 30, 0.95)',
          borderRadius: '16px',
          padding: '32px',
          maxWidth: '600px',
          width: '100%',
          color: '#fff',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <h2
          style={{
            margin: '0 0 16px 0',
            fontSize: '24px',
            fontWeight: 600,
            color: '#fff',
          }}
        >
          {isTesting && !errorMessage ? '🔄 Checking Connectivity...' : '⚠️ Connection Error'}
        </h2>

        {isTesting && !errorMessage && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(59, 130, 246, 0.15)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '8px',
              marginBottom: '20px',
              fontSize: '13px',
              lineHeight: '1.5',
              color: '#93c5fd',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: '16px',
                height: '16px',
                border: '2px solid rgba(147, 197, 253, 0.3)',
                borderTop: '2px solid #93c5fd',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            Testing connection to LLM service...
          </div>
        )}

        {errorMessage && (
          <div
            style={{
              padding: '12px 16px',
              backgroundColor: 'rgba(220, 38, 38, 0.15)',
              border: '1px solid rgba(220, 38, 38, 0.3)',
              borderRadius: '8px',
              marginBottom: '20px',
              fontSize: '13px',
              lineHeight: '1.5',
              fontFamily: 'monospace',
              color: '#fca5a5',
            }}
          >
            {errorMessage}
          </div>
        )}

        {errorMessage && (
          <>
            <p
              style={{
                margin: '0 0 24px 0',
                fontSize: '14px',
                lineHeight: '1.6',
                color: '#d1d5db',
              }}
            >
              Unable to connect to the LLM model. This could be because:
            </p>

            <div
              style={{
                marginBottom: '24px',
              }}
            >
              <div
            style={{
              padding: '16px',
              backgroundColor: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              borderRadius: '8px',
              marginBottom: '16px',
            }}
          >
            <h3
              style={{
                margin: '0 0 12px 0',
                fontSize: '16px',
                fontWeight: 600,
                color: '#60a5fa',
              }}
            >
              1. Ollama is not running
            </h3>
            <ul
              style={{
                margin: '0 0 12px 0',
                paddingLeft: '20px',
                fontSize: '13px',
                lineHeight: '1.6',
                color: '#d1d5db',
              }}
            >
              <li>Download and install <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', textDecoration: 'none' }}>Ollama</a></li>
              <li>Run: <code style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', padding: '2px 6px', borderRadius: '4px' }}>ollama serve</code></li>
              <li>Pull a model: <code style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', padding: '2px 6px', borderRadius: '4px' }}>ollama pull gemma3:12b-it-qat</code></li>
            </ul>
            <p
              style={{
                margin: 0,
                fontSize: '12px',
                color: '#9ca3af',
                fontStyle: 'italic',
              }}
            >
              Ollama should be running at <code style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', padding: '2px 6px', borderRadius: '4px' }}>http://localhost:11434/v1/</code>
            </p>
          </div>

          <div
            style={{
              padding: '16px',
              backgroundColor: 'rgba(16, 185, 129, 0.1)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              borderRadius: '8px',
            }}
          >
            <h3
              style={{
                margin: '0 0 12px 0',
                fontSize: '16px',
                fontWeight: 600,
                color: '#34d399',
              }}
            >
              2. Using OpenAI or another provider
            </h3>
            <ul
              style={{
                margin: '0 0 12px 0',
                paddingLeft: '20px',
                fontSize: '13px',
                lineHeight: '1.6',
                color: '#d1d5db',
              }}
            >
              <li>Open VSCode Settings and search for "Ani VSCode"</li>
              <li>Set <strong>LLM Base URL</strong> to your provider's endpoint (e.g., <code style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', padding: '2px 6px', borderRadius: '4px' }}>https://api.openai.com/v1</code>)</li>
              <li>Set <strong>LLM API Key</strong> to your API key</li>
              <li>Set <strong>LLM Model</strong> to a valid model name (e.g., <code style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', padding: '2px 6px', borderRadius: '4px' }}>gpt-4o-mini</code>)</li>
            </ul>
          </div>
            </div>
          </>
        )}

        <div
          style={{
            display: 'flex',
            gap: '12px',
            justifyContent: errorMessage ? 'flex-end' : 'center',
          }}
        >
          {onDismiss && errorMessage && (
            <button
              onClick={onDismiss}
              style={{
                padding: '10px 20px',
                backgroundColor: 'rgba(75, 85, 99, 0.5)',
                border: '1px solid rgba(107, 114, 128, 0.5)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(75, 85, 99, 0.7)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(75, 85, 99, 0.5)';
              }}
            >
              Dismiss
            </button>
          )}
          {errorMessage && (
            <button
              onClick={openSettings}
              style={{
              padding: '10px 20px',
              backgroundColor: 'rgba(59, 130, 246, 0.8)',
              border: '1px solid rgba(59, 130, 246, 0.5)',
              borderRadius: '8px',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.8)';
            }}
            >
              Open Settings
            </button>
          )}
          {onRetry && (
            <button
              onClick={onRetry}
              disabled={isTesting}
              style={{
                padding: '10px 20px',
                backgroundColor: isTesting ? 'rgba(16, 185, 129, 0.5)' : 'rgba(16, 185, 129, 0.8)',
                border: '1px solid rgba(16, 185, 129, 0.5)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 500,
                cursor: isTesting ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onMouseEnter={(e) => {
                if (!isTesting) {
                  e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 1)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isTesting) {
                  e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.8)';
                }
              }}
            >
              {isTesting && (
                <span
                  style={{
                    display: 'inline-block',
                    width: '14px',
                    height: '14px',
                    border: '2px solid rgba(255, 255, 255, 0.3)',
                    borderTop: '2px solid #fff',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
              )}
              {isTesting ? 'Testing...' : 'Retry Connection'}
              <style>{`
                @keyframes spin {
                  0% { transform: rotate(0deg); }
                  100% { transform: rotate(360deg); }
                }
              `}</style>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

