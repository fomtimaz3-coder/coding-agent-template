'use client'

import { useEffect, useState } from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

type RateLimitInfo = {
  remaining: number
  total: number
  resetAt?: string
}

export function QuotaBadge() {
  const [info, setInfo] = useState<RateLimitInfo | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch('/api/auth/rate-limit')
        if (!res.ok || !mounted) return
        const data = await res.json()
        setInfo({ remaining: data.remaining, total: data.total, resetAt: data.resetAt })
      } catch {
        // ignore
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  if (!info) return null

  const exhausted = info.remaining <= 0
  const resetLabel = info.resetAt
    ? new Date(info.resetAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
    : 'tomorrow'

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`hidden sm:inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              exhausted
                ? 'border-red-500/40 text-red-600 dark:text-red-400'
                : 'border-border text-muted-foreground'
            }`}
          >
            {info.remaining}/{info.total} left
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {exhausted
            ? `Daily message limit reached. Resets ${resetLabel}.`
            : `${info.remaining} of ${info.total} messages remaining today. Resets ${resetLabel}.`}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
