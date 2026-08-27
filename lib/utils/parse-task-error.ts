import type { SandboxErrorCategory, StructuredSandboxError } from './sandbox-errors'

export type ParsedTaskError = {
  category: SandboxErrorCategory | 'unknown'
  code: string
  message: string
  retryable: boolean
  httpStatus?: number
}

const CATEGORY_TITLES: Record<string, string> = {
  timeout: 'Sandbox timed out',
  quota: 'Sandbox quota exceeded',
  network: 'Network error',
  auth: 'Sandbox authentication failed',
  validation: 'Invalid configuration',
  cancelled: 'Cancelled',
  unknown: 'Task failed',
}

export function parseTaskError(raw: string | null | undefined): ParsedTaskError | null {
  if (!raw || !raw.trim()) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StructuredSandboxError> & { message?: string }
    if (parsed && typeof parsed === 'object' && (parsed.code || parsed.category || parsed.message)) {
      const category = (parsed.category as SandboxErrorCategory) || 'unknown'
      return {
        category,
        code: parsed.code || 'UNKNOWN',
        message: parsed.message || raw,
        retryable: Boolean(parsed.retryable),
        httpStatus: parsed.httpStatus,
      }
    }
  } catch {
    // not JSON — treat as plain message
  }

  const lower = raw.toLowerCase()
  let category: SandboxErrorCategory = 'unknown'
  if (lower.includes('quota') || lower.includes('rate limit')) category = 'quota'
  else if (lower.includes('timeout') || lower.includes('timed out')) category = 'timeout'
  else if (lower.includes('unauthorized') || lower.includes('authentication')) category = 'auth'
  else if (lower.includes('network') || lower.includes('econn')) category = 'network'

  return {
    category,
    code: category === 'unknown' ? 'TASK_ERROR' : `SANDBOX_${category.toUpperCase()}`,
    message: raw,
    retryable: category === 'timeout' || category === 'quota' || category === 'network',
  }
}

export function taskErrorTitle(parsed: ParsedTaskError): string {
  return CATEGORY_TITLES[parsed.category] || CATEGORY_TITLES.unknown
}
