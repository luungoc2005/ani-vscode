export interface VsCodeApi {
  postMessage: (message: any) => void;
}

declare global {
  interface Window {
    __aniVsCodeApi?: VsCodeApi | null;
  }
}

let cachedApi: VsCodeApi | null | undefined;

export function getVsCodeApi(): VsCodeApi | null {
  if (cachedApi !== undefined) {
    return cachedApi ?? null;
  }

  if (typeof window === 'undefined') {
    cachedApi = null;
    return cachedApi;
  }

  if (window.__aniVsCodeApi) {
    cachedApi = window.__aniVsCodeApi ?? null;
    return cachedApi;
  }

  const acquire = (window as any).acquireVsCodeApi;
  if (typeof acquire !== 'function') {
    cachedApi = null;
    window.__aniVsCodeApi = cachedApi;
    return cachedApi;
  }

  try {
    cachedApi = acquire();
  } catch (error) {
    console.error('Failed to acquire VS Code API', error);
    cachedApi = null;
  }

  window.__aniVsCodeApi = cachedApi;
  return cachedApi ?? null;
}
