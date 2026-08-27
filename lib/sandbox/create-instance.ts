import { Sandbox } from '@vercel/sandbox'
import { withRetry } from '@/lib/utils/retry'
import { classifySandboxError, isRetryableSandboxError } from '@/lib/utils/sandbox-errors'
import type { TaskLogger } from '@/lib/utils/task-logger'

type SandboxCreateConfig = {
  teamId: string
  projectId: string
  token: string
  timeout: number
  ports: number[]
  runtime: string
  resources: { vcpus: number }
}

/**
 * Create a Vercel Sandbox with exponential backoff for transient failures
 * (timeout, network, quota/rate-limit, 5xx).
 */
export async function createSandboxInstance(
  sandboxConfig: SandboxCreateConfig,
  logger: TaskLogger,
): Promise<Sandbox> {
  return withRetry(() => Sandbox.create(sandboxConfig), {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    shouldRetry: (err) => isRetryableSandboxError(err),
    onRetry: async (err, attempt, delayMs) => {
      const classified = classifySandboxError(err)
      await logger.info(
        `Sandbox.create failed (attempt ${attempt}, ${classified.category}): retrying in ${delayMs}ms…`,
      )
    },
  })
}
