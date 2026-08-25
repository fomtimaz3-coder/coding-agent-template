export function validateEnvironmentVariables(
  selectedAgent: string = 'claude',
  githubToken?: string | null,
  apiKeys?: {
    OPENAI_API_KEY?: string
    GEMINI_API_KEY?: string
    CURSOR_API_KEY?: string
    ANTHROPIC_API_KEY?: string
    AI_GATEWAY_API_KEY?: string
  },
) {
  const errors: string[] = []

  // Unified key resolution - AI_GATEWAY is universal fallback for all agents except copilot
  const hasAiGateway = !!(apiKeys?.AI_GATEWAY_API_KEY || process.env.AI_GATEWAY_API_KEY)
  const hasAnthropic = !!(apiKeys?.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY)
  const hasOpenAI = !!(apiKeys?.OPENAI_API_KEY || process.env.OPENAI_API_KEY)
  const hasGemini = !!(apiKeys?.GEMINI_API_KEY || process.env.GEMINI_API_KEY)
  const hasCursor = !!(apiKeys?.CURSOR_API_KEY || process.env.CURSOR_API_KEY)
  const hasAnyKey = hasAiGateway || hasAnthropic || hasOpenAI || hasGemini || hasCursor

  // Check for required environment variables based on selected agent
  // Claude: needs AI Gateway or Anthropic
  if (selectedAgent === 'claude' && !hasAiGateway && !hasAnthropic) {
    errors.push('AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY is required for Claude CLI. Add one key in profile.')
  }

  // Codex: needs AI Gateway or OpenAI (AI Gateway proxies OpenAI)
  if (selectedAgent === 'codex' && !hasAiGateway && !hasOpenAI) {
    errors.push('AI_GATEWAY_API_KEY or OPENAI_API_KEY is required for Codex CLI. Add one key in profile.')
  }

  // Cursor: now accepts AI Gateway, Anthropic, OpenAI or Cursor key (universal gateway)
  if (selectedAgent === 'cursor' && !hasAnyKey) {
    errors.push('Any API key (AI_GATEWAY, CURSOR, ANTHROPIC, OPENAI) is required for Cursor CLI.')
  }

  // Gemini: accepts Gemini or AI Gateway (gateway proxies Gemini)
  if (selectedAgent === 'gemini' && !hasGemini && !hasAiGateway) {
    errors.push('GEMINI_API_KEY or AI_GATEWAY_API_KEY is required for Gemini CLI.')
  }

  // OpenCode: accepts any key now
  if (selectedAgent === 'opencode' && !hasAnyKey) {
    errors.push('At least one API key (AI_GATEWAY, ANTHROPIC, OPENAI, GEMINI, CURSOR) is required for OpenCode.')
  }

  // Copilot stays free - only needs GitHub token (handled below)

  // Check for GitHub token for private repositories
  // Use user's token if provided
  if (!githubToken) {
    errors.push('GitHub is required for repository access. Please connect your GitHub account.')
  }

  // Check for Vercel sandbox environment variables
  if (!process.env.SANDBOX_VERCEL_TEAM_ID) {
    errors.push('SANDBOX_VERCEL_TEAM_ID is required for sandbox creation')
  }

  if (!process.env.SANDBOX_VERCEL_PROJECT_ID) {
    errors.push('SANDBOX_VERCEL_PROJECT_ID is required for sandbox creation')
  }

  if (!process.env.SANDBOX_VERCEL_TOKEN) {
    errors.push('SANDBOX_VERCEL_TOKEN is required for sandbox creation')
  }

  return {
    valid: errors.length === 0,
    error: errors.length > 0 ? errors.join(', ') : undefined,
  }
}

export function createAuthenticatedRepoUrl(repoUrl: string, githubToken?: string | null): string {
  if (!githubToken) {
    return repoUrl
  }

  try {
    const url = new URL(repoUrl)
    if (url.hostname === 'github.com') {
      // Add GitHub token for authentication
      url.username = githubToken
      url.password = 'x-oauth-basic'
    }
    return url.toString()
  } catch {
    // Failed to parse repository URL
    return repoUrl
  }
}

export function createSandboxConfiguration(config: {
  repoUrl: string
  timeout?: string
  ports?: number[]
  runtime?: string
  resources?: { vcpus?: number }
  branchName?: string
}) {
  return {
    template: 'node',
    git: {
      url: config.repoUrl,
      branch: config.branchName || 'main',
    },
    timeout: config.timeout || '20m',
    ports: config.ports || [3000],
    runtime: config.runtime || 'node22',
    resources: config.resources || { vcpus: 4 },
  }
}
