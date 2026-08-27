export type SandboxErrorCategory =
  | 'timeout'
  | 'quota'
  | 'network'
  | 'auth'
  | 'validation'
  | 'cancelled'
  | 'unknown'

export type StructuredSandboxError = {
  category: SandboxErrorCategory
  code: string
  message: string
  retryable: boolean
  /** HTTP status if present */
  httpStatus?: number
  /** Original error message (redacted upstream if needed) */
  cause?: string
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown error'
  }
}

function getHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const e = error as {
    status?: number
    statusCode?: number
    response?: { status?: number }
  }
  return e.status ?? e.statusCode ?? e.response?.status
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const e = error as { code?: string; name?: string }
  return e.code || e.name
}

/**
 * Classify sandbox / Vercel API failures for structured logging and UX.
 */
export function classifySandboxError(error: unknown): StructuredSandboxError {
  const message = getErrorMessage(error)
  const lower = message.toLowerCase()
  const httpStatus = getHttpStatus(error)
  const code = getErrorCode(error) || 'UNKNOWN'

  // Timeout
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    code === 'ETIMEDOUT' ||
    code === 'TimeoutError' ||
    code === 'ABORT_ERR'
  ) {
    return {
      category: 'timeout',
      code: 'SANDBOX_TIMEOUT',
      message:
        'Sandbox creation timed out. This usually happens with large repositories or slow dependency installs. Try a smaller repo or fewer dependencies.',
      retryable: true,
      httpStatus,
      cause: message,
    }
  }

  // Quota / rate limit
  if (
    httpStatus === 429 ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('limit exceeded')
  ) {
    return {
      category: 'quota',
      code: 'SANDBOX_QUOTA',
      message:
        'Sandbox quota or rate limit exceeded. Wait a few minutes and try again, or check your Vercel sandbox limits.',
      retryable: true,
      httpStatus: httpStatus ?? 429,
      cause: message,
    }
  }

  // Auth / credentials
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('invalid token') ||
    lower.includes('authentication')
  ) {
    return {
      category: 'auth',
      code: 'SANDBOX_AUTH',
      message:
        'Sandbox authentication failed. Check SANDBOX_VERCEL_TOKEN, SANDBOX_VERCEL_TEAM_ID, and SANDBOX_VERCEL_PROJECT_ID.',
      retryable: false,
      httpStatus,
      cause: message,
    }
  }

  // Network
  if (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    lower.includes('network') ||
    lower.includes('fetch failed') ||
    lower.includes('socket')
  ) {
    return {
      category: 'network',
      code: 'SANDBOX_NETWORK',
      message: 'Network error while creating sandbox. Check connectivity and try again.',
      retryable: true,
      httpStatus,
      cause: message,
    }
  }

  // Validation / config
  if (
    httpStatus === 400 ||
    lower.includes('validation') ||
    lower.includes('invalid') ||
    lower.includes('required')
  ) {
    return {
      category: 'validation',
      code: 'SANDBOX_VALIDATION',
      message: message || 'Invalid sandbox configuration.',
      retryable: false,
      httpStatus,
      cause: message,
    }
  }

  // Cancelled
  if (lower.includes('cancel')) {
    return {
      category: 'cancelled',
      code: 'SANDBOX_CANCELLED',
      message: 'Sandbox creation was cancelled.',
      retryable: false,
      httpStatus,
      cause: message,
    }
  }

  return {
    category: 'unknown',
    code: typeof code === 'string' ? code : 'SANDBOX_UNKNOWN',
    message: message || 'Failed to create sandbox',
    retryable: httpStatus !== undefined && httpStatus >= 500,
    httpStatus,
    cause: message,
  }
}

export function isRetryableSandboxError(error: unknown): boolean {
  return classifySandboxError(error).retryable
}

export function formatStructuredError(err: StructuredSandboxError): string {
  const parts = [`[${err.code}]`, err.message]
  if (err.httpStatus) parts.push(`(HTTP ${err.httpStatus})`)
  return parts.join(' ')
}
