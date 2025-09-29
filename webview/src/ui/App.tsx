import React, { useEffect, useRef } from 'react';
import { bootCubism } from '../viewer/boot';

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const dispose = bootCubism(containerRef.current);
    return () => dispose?.();
  }, []);

  return (
    <div style={{ width: '100%', height: '100%' }} ref={containerRef} />
  );
}


