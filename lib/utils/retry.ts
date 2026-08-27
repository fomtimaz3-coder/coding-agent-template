export type RetryOptions = {
  /** Max attempts including the first try (default: 3) */
  maxAttempts?: number
  /** Initial delay in ms (default: 500) */
  baseDelayMs?: number
  /** Max delay in ms (default: 8000) */
  maxDelayMs?: number
  /** Multiplier for exponential backoff (default: 2) */
  factor?: number
  /** Optional jitter ratio 0–1 (default: 0.2) */
  jitter?: number
  /** Return true to retry this error; default retries all */
  shouldRetry?: (error: unknown, attempt: number) => boolean
  /** Called before each retry sleep */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void | Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, factor: number, jitter: number): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(factor, attempt - 1))
  const jitterAmount = exp * jitter * (Math.random() * 2 - 1)
  return Math.max(0, Math.round(exp + jitterAmount))
}

/**
 * Run `fn` with exponential backoff on failure.
 * Retries only when `shouldRetry` returns true (default: always).
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  const baseDelayMs = options.baseDelayMs ?? 500
  const maxDelayMs = options.maxDelayMs ?? 8000
  const factor = options.factor ?? 2
  const jitter = options.jitter ?? 0.2
  const shouldRetry = options.shouldRetry ?? (() => true)

  let lastError: unknown

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const isLast = attempt >= maxAttempts
      if (isLast || !shouldRetry(error, attempt)) {
        throw error
      }
      const delayMs = computeDelay(attempt, baseDelayMs, maxDelayMs, factor, jitter)
      if (options.onRetry) {
        await options.onRetry(error, attempt, delayMs)
      }
      await sleep(delayMs)
    }
  }

  throw lastError
}
