/**
 * fetch() for Telegram's send endpoints, retrying when the request never got a response (connect
 * timeout, reset, DNS blip). The VPS's route to api.telegram.org drops out for a few seconds at a
 * time, which otherwise loses an alert outright. HTTP error responses are returned as-is —
 * those are answers from Telegram (e.g. "bot was blocked"), not transient failures.
 */
const RETRY_DELAYS_MS = [500, 1500];
const ATTEMPT_TIMEOUT_MS = 15_000;

export async function telegramFetch(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
    } catch (error) {
      lastError = error;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
