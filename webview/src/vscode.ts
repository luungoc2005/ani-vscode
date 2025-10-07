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
  if (cachedApi) {
    return cachedApi;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  if (window.__aniVsCodeApi) {
    cachedApi = window.__aniVsCodeApi;
    return cachedApi;
  }

  const acquire = (window as any).acquireVsCodeApi;
  if (typeof acquire !== 'function') {
    return null;
  }

  try {
    const api = acquire();
    if (api) {
      cachedApi = api;
      window.__aniVsCodeApi = api;
      return api;
    }
  } catch (error) {
    console.error('Failed to acquire VS Code API', error);
  }

  return null;
}
