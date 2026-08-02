export const IG_REQUEST_TIMEOUT_MS = 9000;

export class RequestTimeoutError extends Error {
  constructor(message = 'Request timed out') {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

export async function fetchWithTimeout(
  url: string,
  timeoutMs: number = IG_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new RequestTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
