'use client'

import { AlertCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { parseTaskError, taskErrorTitle } from '@/lib/utils/parse-task-error'
import type { Task } from '@/lib/db/schema'

export function TaskErrorBanner({
  task,
  onRetry,
  isRetrying,
}: {
  task: Task
  onRetry?: () => void
  isRetrying?: boolean
}) {
  if (task.status !== 'error' && task.status !== 'stopped') return null

  const parsed = parseTaskError(task.error)
  const title =
    task.status === 'stopped' ? 'Task stopped' : parsed ? taskErrorTitle(parsed) : 'Task failed'
  const message =
    parsed?.message ||
    task.error ||
    (task.status === 'stopped' ? 'This task was stopped before it finished.' : 'An unknown error occurred.')
  const showRetry = task.status === 'error' && (parsed?.retryable ?? true)

  return (
    <div className="mx-3 mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-red-600 dark:text-red-400">{title}</p>
            {parsed?.code && (
              <span className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground border rounded px-1.5 py-0.5">
                {parsed.code}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1 break-words">{message}</p>
          {parsed?.category === 'quota' && (
            <p className="text-xs text-muted-foreground mt-2">
              Vercel sandbox limits reset over time. Wait a few minutes, then retry. Check your Vercel team
              sandbox usage if this keeps happening.
            </p>
          )}
        </div>
        {showRetry && onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={isRetrying} className="flex-shrink-0">
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRetrying ? 'animate-spin' : ''}`} />
            Retry
          </Button>
        )}
      </div>
    </div>
  )
}
