import { authClient } from '@/cloud/auth';
import { CLOUD_CONFIGURED, CLOUD_URL } from '@/cloud/config';

/** The phone holds no JoyoRogo session (never signed in, or signed out). */
export class NotSignedInError extends Error {
  constructor() {
    super('Not signed in to JoyoRogo.');
  }
}

export class CloudNotConfiguredError extends Error {
  constructor() {
    super('The cloud server URL is not set. Set EXPO_PUBLIC_JOYOFIT_CLOUD_URL (or expo.extra.cloudUrl in app.json) and rebuild.');
  }
}

/** The cloud server answered with a non-2xx status. */
export class CloudHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly retryAfterMs: number | null,
  ) {
    super(
      status === 401
        ? 'The JoyoRogo session was rejected. Sign out and sign in again.'
        : `Cloud server answered ${status}${code ? ` (${code})` : ''}.`,
    );
  }
}

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransient(error: unknown): boolean {
  if (error instanceof CloudHttpError) {
    return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  }
  // fetch() rejects with a TypeError (or an abort) when the network is down or the request timed out.
  return !(error instanceof NotSignedInError) && !(error instanceof CloudNotConfiguredError);
}

async function requestOnce<T>(method: string, path: string, body: unknown): Promise<T> {
  if (!CLOUD_CONFIGURED) throw new CloudNotConfiguredError();
  // The session cookies better-auth stored, as a `Cookie` header value; the Worker forwards them to JoyoRogo.
  const cookie = await authClient.getCookie();
  if (!cookie) throw new NotSignedInError();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${CLOUD_URL}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!response.ok) {
      const json = (await response.json().catch(() => null)) as { error?: unknown } | null;
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new CloudHttpError(
        response.status,
        typeof json?.error === 'string' ? json.error : null,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls the JoyoFit cloud Worker with the JoyoRogo session. Network errors, timeouts, 408/425/429 and 5xx
 * are retried with exponential backoff (1 s, 2 s, 4 s, honouring Retry-After); other errors surface at once.
 */
export async function cloudRequest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await requestOnce<T>(method, path, body);
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isTransient(error)) throw error;
      const hinted = error instanceof CloudHttpError ? error.retryAfterMs : null;
      await sleep(Math.min(MAX_DELAY_MS, hinted ?? BASE_DELAY_MS * 2 ** (attempt - 1)) + Math.random() * 250);
    }
  }
}
