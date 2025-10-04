import React, { useEffect, useState } from 'react';

interface Motion {
  group: string;
  index: number;
  fileName: string;
}

interface Expression {
  name: string;
  fileName: string;
}

interface DebugPanelProps {
  visible: boolean;
}

interface ConsoleLog {
  type: 'log' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export function DebugPanel({ visible }: DebugPanelProps) {
  const [motions, setMotions] = useState<Motion[]>([]);
  const [expressions, setExpressions] = useState<Expression[]>([]);
  const [currentModel, setCurrentModel] = useState<string>('');
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);

  useEffect(() => {
    // Intercept console methods
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };

    const addLog = (type: 'log' | 'warn' | 'error', args: any[]) => {
      const message = args.map(arg => {
        if (typeof arg === 'object') {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ');

      setConsoleLogs(prev => [...prev.slice(-99), { type, message, timestamp: Date.now() }]);
    };

    console.log = (...args: any[]) => {
      originalConsole.log(...args);
      addLog('log', args);
    };

    console.warn = (...args: any[]) => {
      originalConsole.warn(...args);
      addLog('warn', args);
    };

    console.error = (...args: any[]) => {
      originalConsole.error(...args);
      addLog('error', args);
    };

    return () => {
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
    };
  }, []);

  useEffect(() => {
    // Fetch available motions when visible
    if (visible) {
      // Initial fetch
      fetchMotions();
      
      // Also set up a periodic refresh to catch model changes
      const interval = setInterval(fetchMotions, 1000);
      return () => clearInterval(interval);
    }
  }, [visible]);

  const fetchMotions = () => {
    try {
      if ((window as any).getAvailableMotions) {
        const data = (window as any).getAvailableMotions();
        // console.log('Debug Panel - Fetched motions:', data);
        setMotions(data.motions || []);
        setExpressions(data.expressions || []);
        setCurrentModel(data.modelName || '');
      } else {
        console.warn('Debug Panel - getAvailableMotions not available on window');
      }
    } catch (error) {
      console.error('Debug Panel - Error fetching motions:', error);
    }
  };

  const playMotion = (group: string, index: number) => {
    if ((window as any).playMotion) {
      (window as any).playMotion(group, index);
    }
  };

  const applyExpression = (expressionId: string) => {
    if ((window as any).playExpression) {
      (window as any).playExpression(expressionId);
    }
  };

  if (!visible) {
    return null;
  }

  // Group motions by group name
  const groupedMotions = motions.reduce((acc, motion) => {
    if (!acc[motion.group]) {
      acc[motion.group] = [];
    }
    acc[motion.group].push(motion);
    return acc;
  }, {} as Record<string, Motion[]>);

  return (
    <div
      style={{
        position: 'fixed',
        left: '10px',
        top: '50%',
        transform: 'translateY(-50%)',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        color: '#fff',
        padding: '15px',
        borderRadius: '8px',
        maxHeight: '80vh',
        overflowY: 'auto',
        width: '250px',
        fontSize: '12px',
        fontFamily: 'monospace',
        zIndex: 1000,
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      }}
    >
      <div
        style={{
          fontSize: '14px',
          fontWeight: 'bold',
          marginBottom: '12px',
          paddingBottom: '8px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
        }}
      >
        🎭 Motion Debug Panel
      </div>

      {currentModel && (
        <div
          style={{
            fontSize: '11px',
            marginBottom: '12px',
            color: '#aaa',
          }}
        >
          Model: {currentModel}
        </div>
      )}

      {Object.keys(groupedMotions).length === 0 ? (
        <div style={{ color: '#888', fontStyle: 'italic' }}>
          No motions available
        </div>
      ) : (
        Object.entries(groupedMotions).map(([groupName, groupMotions]) => (
          <div key={groupName} style={{ marginBottom: '15px' }}>
            <div
              style={{
                fontSize: '11px',
                fontWeight: 'bold',
                color: '#4CAF50',
                marginBottom: '6px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {groupName}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {groupMotions.map((motion) => (
                <button
                  key={`${motion.group}-${motion.index}`}
                  onClick={() => playMotion(motion.group, motion.index)}
                  style={{
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    color: '#fff',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    borderRadius: '4px',
                    padding: '6px 10px',
                    cursor: 'pointer',
                    fontSize: '11px',
                    textAlign: 'left',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(76, 175, 80, 0.3)';
                    e.currentTarget.style.borderColor = '#4CAF50';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                  }}
                >
                  {motion.fileName}
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      <div
        style={{
          marginTop: '10px',
          marginBottom: '10px',
          paddingTop: '10px',
          borderTop: '1px solid rgba(255, 255, 255, 0.2)',
        }}
      >
        <div
          style={{
            fontSize: '12px',
            fontWeight: 'bold',
            marginBottom: '8px',
            color: '#FFC107',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          😊 Expressions
        </div>
        {expressions.length === 0 ? (
          <div style={{ color: '#888', fontStyle: 'italic' }}>No expressions available</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {expressions.map((expression) => (
              <button
                key={expression.name}
                onClick={() => applyExpression(expression.name)}
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  color: '#fff',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  borderRadius: '4px',
                  padding: '5px 10px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  textAlign: 'left',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 193, 7, 0.25)';
                  e.currentTarget.style.borderColor = '#FFC107';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                }}
              >
                <div style={{ fontWeight: 'bold' }}>{expression.name}</div>
                <div style={{ fontSize: '9px', color: '#bbb' }}>{expression.fileName}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: '15px',
          paddingTop: '10px',
          borderTop: '1px solid rgba(255, 255, 255, 0.2)',
          fontSize: '10px',
          color: '#666',
          textAlign: 'center',
        }}
      >
        Click a motion to play or an expression to apply
      </div>

      <button
        onClick={() => setShowLogs(!showLogs)}
        style={{
          width: '100%',
          marginTop: '10px',
          backgroundColor: 'rgba(33, 150, 243, 0.2)',
          color: '#2196F3',
          border: '1px solid rgba(33, 150, 243, 0.5)',
          borderRadius: '4px',
          padding: '6px',
          cursor: 'pointer',
          fontSize: '11px',
          fontWeight: 'bold',
        }}
      >
        {showLogs ? '🔽 Hide Console' : '🔼 Show Console'} {consoleLogs.length > 0 && `(${consoleLogs.length})`}
      </button>

      {showLogs && (
        <div
          style={{
            marginTop: '10px',
            padding: '10px',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            borderRadius: '4px',
            maxHeight: '200px',
            overflowY: 'auto',
            fontSize: '10px',
            fontFamily: 'monospace',
          }}
        >
          <div style={{ marginBottom: '8px', display: 'flex', gap: '6px', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', fontSize: '10px' }}>
              <input
                type="checkbox"
                checked={showOnlyErrors}
                onChange={(e) => setShowOnlyErrors(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
              <span style={{ color: '#f44336' }}>Errors only</span>
            </label>
          </div>
          {consoleLogs.length === 0 ? (
            <div style={{ color: '#888', fontStyle: 'italic' }}>No console logs yet</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {consoleLogs
                .filter(log => !showOnlyErrors || log.type === 'error')
                .slice(-20)
                .map((log, index) => (
                <div
                  key={index}
                  style={{
                    padding: '4px 6px',
                    borderRadius: '2px',
                    backgroundColor: 
                      log.type === 'error' ? 'rgba(244, 67, 54, 0.2)' :
                      log.type === 'warn' ? 'rgba(255, 152, 0, 0.2)' :
                      'rgba(255, 255, 255, 0.05)',
                    color:
                      log.type === 'error' ? '#f44336' :
                      log.type === 'warn' ? '#ff9800' :
                      '#aaa',
                    borderLeft: `2px solid ${
                      log.type === 'error' ? '#f44336' :
                      log.type === 'warn' ? '#ff9800' :
                      '#4CAF50'
                    }`,
                    wordBreak: 'break-word',
                  }}
                >
                  <div style={{ fontSize: '9px', opacity: 0.6, marginBottom: '2px' }}>
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </div>
                  {log.message}
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => setConsoleLogs([])}
            style={{
              width: '100%',
              marginTop: '8px',
              backgroundColor: 'rgba(244, 67, 54, 0.2)',
              color: '#f44336',
              border: '1px solid rgba(244, 67, 54, 0.5)',
              borderRadius: '4px',
              padding: '4px',
              cursor: 'pointer',
              fontSize: '10px',
            }}
          >
            Clear Logs
          </button>
        </div>
      )}
    </div>
  );
}
