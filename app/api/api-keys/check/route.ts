import { NextRequest, NextResponse } from 'next/server'
import { getUserApiKey } from '@/lib/api-keys/user-keys'

type Provider = 'openai' | 'gemini' | 'cursor' | 'anthropic' | 'aigateway'

// Map agents to their required providers
// Now AI Gateway is universal fallback for all
const AGENT_PROVIDER_MAP: Record<string, Provider | null> = {
  claude: 'aigateway', // Claude uses Vercel AI Gateway (or anthropic)
  codex: 'aigateway', // Codex uses Vercel AI Gateway (or openai)
  copilot: null, // Copilot uses user's GitHub token from their account
  cursor: 'aigateway', // Now prefers AI Gateway, fallback to cursor key
  gemini: 'aigateway', // Now prefers AI Gateway, fallback to gemini key
  opencode: 'aigateway', // OpenCode can use any key, prefers AI Gateway
}

// Check if a model is an Anthropic model
function isAnthropicModel(model: string): boolean {
  const anthropicPatterns = ['claude', 'sonnet', 'opus']
  const lowerModel = model.toLowerCase()
  return anthropicPatterns.some((pattern) => lowerModel.includes(pattern))
}

// Check if a model is an OpenAI model
function isOpenAIModel(model: string): boolean {
  const openaiPatterns = ['gpt', 'openai']
  const lowerModel = model.toLowerCase()
  return openaiPatterns.some((pattern) => lowerModel.includes(pattern))
}

// Check if a model is a Gemini model
function isGeminiModel(model: string): boolean {
  const geminiPatterns = ['gemini']
  const lowerModel = model.toLowerCase()
  return geminiPatterns.some((pattern) => lowerModel.includes(pattern))
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const agent = searchParams.get('agent')
    const model = searchParams.get('model')

    if (!agent) {
      return NextResponse.json({ error: 'Agent parameter is required' }, { status: 400 })
    }

    let provider = AGENT_PROVIDER_MAP[agent]
    if (provider === undefined) {
      return NextResponse.json({ error: 'Invalid agent' }, { status: 400 })
    }

    // Always get GitHub token - it's universal fallback via Copilot
    const { getUserGitHubToken } = await import('@/lib/github/user-token')
    const githubToken = await getUserGitHubToken()

    // Special handling for Copilot - check if user has GitHub token
    if (agent === 'copilot') {
      const hasKey = !!githubToken

      return NextResponse.json({
        success: true,
        hasKey,
        provider: 'github',
        agentName: 'Copilot',
      })
    }

    // Override provider based on model for multi-provider agents, but always try AI Gateway first
    // AI Gateway can proxy to almost everything
    const aiGatewayKey = await getUserApiKey('aigateway')
    if (aiGatewayKey) {
      // If AI Gateway exists, it satisfies any agent
      return NextResponse.json({
        success: true,
        hasKey: true,
        provider: 'aigateway',
        agentName: agent.charAt(0).toUpperCase() + agent.slice(1),
        fallback: true,
      })
    }

    // If no API key but GitHub token exists, allow any agent via Copilot fallback
    // This makes ALL models functional even without paid keys
    if (githubToken) {
      return NextResponse.json({
        success: true,
        hasKey: true,
        provider: 'github',
        agentName: agent.charAt(0).toUpperCase() + agent.slice(1),
        fallback: true,
        fallbackToCopilot: true,
        message: 'Will use Copilot as fallback engine',
      })
    }

    // Override provider based on model for multi-provider agents
    if (model && (agent === 'cursor' || agent === 'opencode' || agent === 'claude' || agent === 'codex' || agent === 'gemini')) {
      if (isAnthropicModel(model)) {
        provider = 'anthropic'
      } else if (isGeminiModel(model)) {
        provider = 'gemini'
      } else if (isOpenAIModel(model)) {
        provider = 'aigateway'
      }
    }

    // Check if API key is available (either user's or system)
    // If provider is still null (should not happen except copilot), check any key
    if (!provider) {
      const anyKeys = await Promise.all([
        getUserApiKey('aigateway'),
        getUserApiKey('openai'),
        getUserApiKey('anthropic'),
        getUserApiKey('gemini'),
        getUserApiKey('cursor'),
      ])
      const hasAny = anyKeys.some(Boolean)
      return NextResponse.json({
        success: true,
        hasKey: hasAny,
        provider: 'aigateway',
        agentName: agent.charAt(0).toUpperCase() + agent.slice(1),
      })
    }

    // Check any key as last resort - any key unlocks any agent now
    const anyKeys = await Promise.all([
      getUserApiKey('aigateway'),
      getUserApiKey('openai'),
      getUserApiKey('anthropic'),
      getUserApiKey('gemini'),
      getUserApiKey('cursor'),
    ])
    const hasAnyKey = anyKeys.some(Boolean)
    if (hasAnyKey) {
      return NextResponse.json({
        success: true,
        hasKey: true,
        provider: 'aigateway',
        agentName: agent.charAt(0).toUpperCase() + agent.slice(1),
        fallback: true,
      })
    }

    const apiKey = await getUserApiKey(provider!)
    const hasKey = !!apiKey

    return NextResponse.json({
      success: true,
      hasKey,
      provider,
      agentName: agent.charAt(0).toUpperCase() + agent.slice(1),
    })
  } catch (error) {
    console.error('Error checking API key:', error)
    return NextResponse.json({ error: 'Failed to check API key' }, { status: 500 })
  }
}
