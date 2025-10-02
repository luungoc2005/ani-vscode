import * as dns from 'dns';

/**
 * Check if there is internet connectivity by performing a DNS lookup
 * @param timeout Timeout in milliseconds (default: 5000ms)
 * @returns Promise<boolean> true if internet is available, false otherwise
 */
export async function hasInternetConnectivity(timeout: number = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    // Use a reliable DNS name (Google's DNS)
    const timeoutId = setTimeout(() => {
      resolve(false);
    }, timeout);

    dns.resolve('google.com', (err) => {
      clearTimeout(timeoutId);
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Cached connectivity status
 */
let cachedConnectivity: { status: boolean; timestamp: number } | null = null;
const CACHE_DURATION = 60000; // Cache for 1 minute

/**
 * Check internet connectivity with caching to avoid excessive checks
 * @param cacheDuration Duration to cache the result in milliseconds (default: 60000ms)
 * @returns Promise<boolean> true if internet is available, false otherwise
 */
export async function hasInternetConnectivityCached(cacheDuration: number = CACHE_DURATION): Promise<boolean> {
  const now = Date.now();
  
  // Return cached result if still valid
  if (cachedConnectivity && (now - cachedConnectivity.timestamp) < cacheDuration) {
    return cachedConnectivity.status;
  }

  // Check connectivity
  const status = await hasInternetConnectivity();
  
  // Update cache
  cachedConnectivity = {
    status,
    timestamp: now
  };

  return status;
}
