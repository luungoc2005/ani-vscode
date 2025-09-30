import React, { useEffect, useState } from 'react';

interface Motion {
  group: string;
  index: number;
  fileName: string;
}

interface DebugPanelProps {
  visible: boolean;
}

export function DebugPanel({ visible }: DebugPanelProps) {
  const [motions, setMotions] = useState<Motion[]>([]);
  const [currentModel, setCurrentModel] = useState<string>('');

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
        console.log('Debug Panel - Fetched motions:', data);
        setMotions(data.motions || []);
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
          marginTop: '15px',
          paddingTop: '10px',
          borderTop: '1px solid rgba(255, 255, 255, 0.2)',
          fontSize: '10px',
          color: '#666',
          textAlign: 'center',
        }}
      >
        Click a motion to play
      </div>
    </div>
  );
}
