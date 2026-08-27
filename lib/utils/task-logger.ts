import { db } from '@/lib/db/client'
import { tasks } from '@/lib/db/schema'
import { eq, and, notInArray } from 'drizzle-orm'
import { createInfoLog, createCommandLog, createErrorLog, createSuccessLog, LogEntry } from './logging'
import type { StructuredSandboxError } from './sandbox-errors'
import { formatStructuredError } from './sandbox-errors'

/** Statuses that must not be overwritten by a later update (atomic terminal states) */
const TERMINAL_STATUSES = ['completed', 'error', 'stopped'] as const

export class TaskLogger {
  private taskId: string

  constructor(taskId: string) {
    this.taskId = taskId
  }

  /**
   * Append a log entry to the database immediately
   */
  async append(type: 'info' | 'command' | 'error' | 'success', message: string): Promise<void> {
    try {
      let logEntry: LogEntry
      switch (type) {
        case 'info':
          logEntry = createInfoLog(message)
          break
        case 'command':
          logEntry = createCommandLog(message)
          break
        case 'error':
          logEntry = createErrorLog(message)
          break
        case 'success':
          logEntry = createSuccessLog(message)
          break
        default:
          logEntry = createInfoLog(message)
      }

      const currentTask = await db.select().from(tasks).where(eq(tasks.id, this.taskId)).limit(1)
      const existingLogs = currentTask[0]?.logs || []

      await db
        .update(tasks)
        .set({
          logs: [...existingLogs, logEntry],
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, this.taskId))
    } catch {
      // Don't throw — logging failures must not break the main process
    }
  }

  async info(message: string): Promise<void> {
    return this.append('info', message)
  }

  async command(message: string): Promise<void> {
    return this.append('command', message)
  }

  async error(message: string): Promise<void> {
    return this.append('error', message)
  }

  async success(message: string): Promise<void> {
    return this.append('success', message)
  }

  /**
   * Persist a structured error for debugging (DB + log stream).
   * Writes JSON to tasks.error so operators can filter by code/category.
   */
  async logStructuredError(structured: StructuredSandboxError, context?: string): Promise<void> {
    try {
      const payload = {
        ...structured,
        context: context || undefined,
        at: new Date().toISOString(),
      }
      const human = formatStructuredError(structured)
      const logEntry = createErrorLog(context ? `${context}: ${human}` : human)

      const currentTask = await db.select().from(tasks).where(eq(tasks.id, this.taskId)).limit(1)
      const existingLogs = currentTask[0]?.logs || []

      await db
        .update(tasks)
        .set({
          error: JSON.stringify(payload),
          logs: [...existingLogs, logEntry],
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, this.taskId))
    } catch {
      // swallow
    }
  }

  /**
   * Update task progress along with a log message
   */
  async updateProgress(progress: number, message: string): Promise<void> {
    try {
      const logEntry = createInfoLog(message)
      const currentTask = await db.select().from(tasks).where(eq(tasks.id, this.taskId)).limit(1)
      const existingLogs = currentTask[0]?.logs || []

      await db
        .update(tasks)
        .set({
          progress,
          logs: [...existingLogs, logEntry],
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, this.taskId))
    } catch {
      // swallow
    }
  }

  /**
   * Atomically update task status.
   * Will not overwrite a terminal status (completed / error / stopped)
   * unless `force` is true — prevents race conditions between timeout,
   * cancellation, and normal completion paths.
   */
  async updateStatus(
    status: 'pending' | 'processing' | 'completed' | 'error' | 'stopped',
    message?: string,
    options?: { force?: boolean; errorMessage?: string },
  ): Promise<boolean> {
    try {
      const updates: {
        status: 'pending' | 'processing' | 'completed' | 'error' | 'stopped'
        updatedAt: Date
        logs?: LogEntry[]
        error?: string
      } = {
        status,
        updatedAt: new Date(),
      }

      if (message) {
        const logEntry = createInfoLog(message)
        const currentTask = await db.select().from(tasks).where(eq(tasks.id, this.taskId)).limit(1)
        const existingLogs = currentTask[0]?.logs || []
        updates.logs = [...existingLogs, logEntry]
      }

      if (options?.errorMessage) {
        updates.error = options.errorMessage
      }

      // Atomic: only update if still non-terminal (unless force)
      if (options?.force) {
        await db.update(tasks).set(updates).where(eq(tasks.id, this.taskId))
        return true
      }

      const result = await db
        .update(tasks)
        .set(updates)
        .where(and(eq(tasks.id, this.taskId), notInArray(tasks.status, [...TERMINAL_STATUSES])))
        .returning({ id: tasks.id })

      return result.length > 0
    } catch {
      return false
    }
  }
}

export function createTaskLogger(taskId: string): TaskLogger {
  return new TaskLogger(taskId)
}
