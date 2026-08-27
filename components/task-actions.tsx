'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { Task } from '@/lib/db/schema'
import { parseTaskError } from '@/lib/utils/parse-task-error'
import { useTasks } from '@/components/app-layout'

interface TaskActionsProps {
  task: Task
}

export async function retryTask(task: Task): Promise<string | null> {
  const response = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: task.prompt,
      repoUrl: task.repoUrl,
      selectedAgent: task.selectedAgent,
      selectedModel: task.selectedModel,
      installDependencies: task.installDependencies,
      maxDuration: task.maxDuration,
      keepAlive: task.keepAlive,
      enableBrowser: task.enableBrowser,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || error.error || 'Failed to retry task')
  }

  const data = await response.json()
  return data.task?.id ?? null
}

export function TaskActions({ task }: TaskActionsProps) {
  const router = useRouter()
  const { refreshTasks } = useTasks()
  const [isRetrying, setIsRetrying] = useState(false)

  if (task.status !== 'error') return null

  const parsed = parseTaskError(task.error)
  if (parsed && !parsed.retryable) return null

  const handleRetry = async () => {
    setIsRetrying(true)
    try {
      const newId = await retryTask(task)
      toast.success('Retry started')
      await refreshTasks()
      if (newId) router.push(`/tasks/${newId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to retry task')
    } finally {
      setIsRetrying(false)
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={handleRetry} disabled={isRetrying} className="h-8">
      <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isRetrying ? 'animate-spin' : ''}`} />
      Retry
    </Button>
  )
}
