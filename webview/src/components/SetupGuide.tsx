import React from 'react';
import { getVsCodeApi } from '../vscode';

interface SetupGuideProps {
  visible: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  isTesting?: boolean;
}

const styles = {
  overlay: {
    position: 'fixed' as const,
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
  },
  card: {
    backgroundColor: 'rgba(30, 30, 30, 0.95)',
    borderRadius: '16px',
    padding: '32px',
    maxWidth: '600px',
    width: '100%',
    color: '#fff',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
    fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  },
  title: {
    margin: '0 0 16px 0',
    fontSize: '24px',
    fontWeight: 600,
    color: '#fff',
  },
  infoBox: {
    padding: '12px 16px',
    borderRadius: '8px',
    marginBottom: '20px',
    fontSize: '13px',
    lineHeight: 1.5,
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  testingBox: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    border: '1px solid rgba(59, 130, 246, 0.3)',
    color: '#93c5fd',
  },
  spinner: {
    display: 'inline-block',
    width: '16px',
    height: '16px',
    border: '2px solid rgba(147, 197, 253, 0.3)',
    borderTop: '2px solid #93c5fd',
    borderRadius: '50%',
    animation: 'setupGuideSpin 0.8s linear infinite',
  },
  errorBox: {
    padding: '12px 16px',
    backgroundColor: 'rgba(220, 38, 38, 0.15)',
    border: '1px solid rgba(220, 38, 38, 0.3)',
    borderRadius: '8px',
    marginBottom: '20px',
    fontSize: '13px',
    lineHeight: 1.5,
    fontFamily: 'monospace',
    color: '#fca5a5',
  },
  description: {
    margin: '0 0 24px 0',
    fontSize: '14px',
    lineHeight: 1.6,
    color: '#d1d5db',
  },
  sectionList: {
    marginBottom: '24px',
  },
  section: {
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '16px',
  },
  sectionTitle: {
    margin: '0 0 12px 0',
    fontSize: '16px',
    fontWeight: 600,
  },
  sectionListItems: {
    margin: '0 0 12px 0',
    paddingLeft: '20px',
    fontSize: '13px',
    lineHeight: 1.6,
    color: '#d1d5db',
  },
  note: {
    margin: 0,
    fontSize: '12px',
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  actions: {
    display: 'flex',
    gap: '12px',
  },
  button: {
    padding: '10px 20px',
    borderRadius: '8px',
    color: '#fff',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
    border: '1px solid transparent',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mutedButton: {
    backgroundColor: 'rgba(75, 85, 99, 0.5)',
    borderColor: 'rgba(107, 114, 128, 0.5)',
  },
  primaryButton: {
    backgroundColor: 'rgba(59, 130, 246, 0.8)',
    borderColor: 'rgba(59, 130, 246, 0.5)',
  },
  successButton: {
    backgroundColor: 'rgba(16, 185, 129, 0.8)',
    borderColor: 'rgba(16, 185, 129, 0.5)',
  },
};

const spinnerKeyframes = `
  @keyframes setupGuideSpin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`;

const hoverHandlers = (base: string, hover: string) => ({
  onMouseEnter: (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.style.backgroundColor = hover;
  },
  onMouseLeave: (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.style.backgroundColor = base;
  },
});

export function SetupGuide(props: SetupGuideProps) {
  const { visible, errorMessage, onRetry, onDismiss, isTesting } = props;

  if (!visible) return null;

  const isChecking = Boolean(isTesting);
  const hasError = Boolean(errorMessage);
  const showErrorDetails = hasError && !isChecking;
  const showRetryButton = Boolean(onRetry) && !isChecking;
  const showErrorActions = hasError && !isChecking;

  const handleOpenSettings = () => {
    const vscode = getVsCodeApi();
    if (vscode) {
      vscode.postMessage({ type: 'openSettings' });
    }
  };

  return (
    <div style={styles.overlay}>
      <style>{spinnerKeyframes}</style>
      <div style={styles.card}>
        <h2 style={styles.title}>
          {isChecking ? '🔄 Checking Connectivity...' : '⚠️ Connection Error'}
        </h2>

        {isChecking && (
          <div style={{ ...styles.infoBox, ...styles.testingBox }}>
            <span style={styles.spinner} />
            Testing connection to LLM service...
          </div>
        )}

        {hasError && !isChecking && (
          <div style={styles.errorBox}>{errorMessage}</div>
        )}

        {showErrorDetails && (
          <>
            <p style={styles.description}>
              Unable to connect to the LLM model. This could be because:
            </p>

            <div style={styles.sectionList}>
              <div
                style={{
                  ...styles.section,
                  backgroundColor: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                }}
              >
                <h3 style={{ ...styles.sectionTitle, color: '#60a5fa' }}>
                  1. Ollama is not running
                </h3>
                <ul style={styles.sectionListItems}>
                  <li>
                    Download and install{' '}
                    <a
                      href="https://ollama.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#60a5fa', textDecoration: 'none' }}
                    >
                      Ollama
                    </a>
                  </li>
                  <li>
                    Run:{' '}
                    <code style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', padding: '2px 6px', borderRadius: '4px' }}>
                      ollama serve
                    </code>
                  </li>
                  <li>
                    Pull a model:{' '}
                    <code style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', padding: '2px 6px', borderRadius: '4px' }}>
                      ollama pull gemma3:12b-it-qat
                    </code>
                  </li>
                </ul>
                <p style={styles.note}>
                  Ollama should be running at{' '}
                  <code style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', padding: '2px 6px', borderRadius: '4px' }}>
                    http://localhost:11434/v1/
                  </code>
                </p>
              </div>

              <div
                style={{
                  ...styles.section,
                  backgroundColor: 'rgba(16, 185, 129, 0.1)',
                  border: '1px solid rgba(16, 185, 129, 0.2)',
                }}
              >
                <h3 style={{ ...styles.sectionTitle, color: '#34d399' }}>
                  2. Using OpenAI or another provider
                </h3>
                <ul style={styles.sectionListItems}>
                  <li>Open VSCode Settings and search for "Ani VSCode"</li>
                  <li>
                    Set <strong>LLM Base URL</strong> to your provider's endpoint (e.g.,{' '}
                    <code style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', padding: '2px 6px', borderRadius: '4px' }}>
                      https://api.openai.com/v1
                    </code>
                    )
                  </li>
                  <li>Set <strong>LLM API Key</strong> to your API key</li>
                  <li>
                    Set <strong>LLM Model</strong> to a valid model name (e.g.,{' '}
                    <code style={{ backgroundColor: 'rgba(0, 0, 0, 0.3)', padding: '2px 6px', borderRadius: '4px' }}>
                      gpt-4o-mini
                    </code>
                    )
                  </li>
                </ul>
              </div>
            </div>
          </>
        )}

        <div
          style={{
            ...styles.actions,
            justifyContent: hasError ? 'flex-end' : 'center',
          }}
        >
          {showErrorActions && onDismiss && (
            <button
              onClick={onDismiss}
              style={{ ...styles.button, ...styles.mutedButton }}
              {...hoverHandlers('rgba(75, 85, 99, 0.5)', 'rgba(75, 85, 99, 0.7)')}
            >
              Dismiss
            </button>
          )}

          {showErrorActions && (
            <button
              onClick={handleOpenSettings}
              style={{ ...styles.button, ...styles.primaryButton }}
              {...hoverHandlers('rgba(59, 130, 246, 0.8)', 'rgba(59, 130, 246, 1)')}
            >
              Open Settings
            </button>
          )}

          {showRetryButton && (
            <button
              onClick={onRetry}
              style={{ ...styles.button, ...styles.successButton }}
              {...hoverHandlers('rgba(16, 185, 129, 0.8)', 'rgba(16, 185, 129, 1)')}
            >
              Retry Connection
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

