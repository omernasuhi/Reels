import "server-only";

export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    public url: string,
  ) {
    super(`HTTP ${status} from ${new URL(url).host}: ${body.slice(0, 300)}`);
  }
}

type Options = RequestInit & { timeoutMs?: number; retries?: number };

// Zaman aşımı + üstel beklemeli yeniden deneme. 429 ve 5xx yanıtlarında,
// ağ hatalarında tekrar dener; Retry-After başlığına uyar.
export async function fetchRetry(url: string, options: Options = {}): Promise<Response> {
  const { timeoutMs = 60_000, retries = 4, ...init } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      const body = await res.text();
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === retries) throw new HttpError(res.status, body, url);
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : backoff(attempt));
      lastError = new HttpError(res.status, body, url);
    } catch (err) {
      if (err instanceof HttpError && err.status !== 429 && err.status < 500) throw err;
      lastError = err;
      if (attempt === retries) break;
      if (!(err instanceof HttpError)) await sleep(backoff(attempt));
    }
  }
  throw lastError;
}

function backoff(attempt: number) {
  return Math.min(30_000, 1000 * 2 ** attempt) + Math.random() * 500;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
