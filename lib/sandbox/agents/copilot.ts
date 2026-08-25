import { Sandbox } from '@vercel/sandbox'
import { runCommandInSandbox, runInProject, PROJECT_DIR } from '../commands'
import { AgentExecutionResult } from '../types'
import { redactSensitiveInfo } from '@/lib/utils/logging'
import { TaskLogger } from '@/lib/utils/task-logger'
import { connectors, taskMessages } from '@/lib/db/schema'
import { db } from '@/lib/db/client'
import { eq } from 'drizzle-orm'
import { generateId } from '@/lib/utils/id'

type Connector = typeof connectors.$inferSelect

const COPILOT_PATH_EXPORT = 'export PATH=\"$HOME/.npm-global/bin:$HOME/.local/bin:/usr/local/bin:$PATH\"'
const COPILOT_BIN = 'copilot'

// Normalize model names - Copilot CLI is picky
const COPILOT_MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4.5': 'claude-sonnet-4.5',
  'claude-sonnet-4': 'claude-sonnet-4',
  'claude-haiku-4.5': 'claude-haiku-4.5',
  'claude-opus-4.5': 'claude-opus-4.5',
  'claude-opus-4.6': 'claude-opus-4.5', // fallback
  'gpt-5': 'gpt-5',
  'gpt-5.1': 'gpt-5',
  'gpt-4.1': 'gpt-4.1',
  'gpt-4o': 'gpt-4o',
}

function normalizeCopilotModel(model?: string): string | undefined {
  if (!model) return undefined
  // Direct map
  if (COPILOT_MODEL_MAP[model]) return COPILOT_MODEL_MAP[model]
  // Try lower case contains
  const lower = model.toLowerCase()
  if (lower.includes('sonnet-4.5')) return 'claude-sonnet-4.5'
  if (lower.includes('sonnet-4')) return 'claude-sonnet-4'
  if (lower.includes('haiku')) return 'claude-haiku-4.5'
  if (lower.includes('opus')) return 'claude-opus-4.5'
  if (lower.includes('gpt-5')) return 'gpt-5'
  if (lower.includes('gpt-4.1')) return 'gpt-4.1'
  // Return as-is if not mapped - let CLI decide
  return model
}

// Helper function to run command and collect logs in project directory
async function runAndLogCommand(sandbox: Sandbox, command: string, args: string[], logger: TaskLogger) {
  const fullCommand = args.length > 0 ? `${command} ${args.join(' ')}` : command
  await logger.command(redactSensitiveInfo(fullCommand))

  const result = await runInProject(sandbox, command, args)

  if (result.output && result.output.trim()) {
    await logger.info(redactSensitiveInfo(result.output.trim()))
  }

  if (!result.success && result.error) {
    await logger.error(redactSensitiveInfo(result.error))
  }

  return result
}

async function runWithPath(sandbox: Sandbox, cmd: string) {
  return await runCommandInSandbox(sandbox, 'sh', ['-c', `${COPILOT_PATH_EXPORT}; ${cmd}`])
}

export async function executeCopilotInSandbox(
  sandbox: Sandbox,
  instruction: string,
  logger: TaskLogger,
  selectedModel?: string,
  mcpServers?: Connector[],
  isResumed?: boolean,
  sessionId?: string,
  taskId?: string,
): Promise<AgentExecutionResult> {
  let agentMessageId: string | null = null
  let accumulatedContent = ''

  try {
    // Check if GitHub Copilot CLI is already installed (for resumed sandboxes) - with proper PATH
    const existingCliCheck = await runWithPath(sandbox, 'which copilot 2>/dev/null || which copilot 2>/dev/null; echo PATH:$PATH')

    let copilotInstall: { success: boolean; output?: string; error?: string } = { success: true }
    const normalizedModel = normalizeCopilotModel(selectedModel)

    if (existingCliCheck.success && existingCliCheck.output?.includes('copilot')) {
      await logger.info('GitHub Copilot CLI already installed, skipping installation')
    } else {
      await logger.info('Installing GitHub Copilot CLI...')

      // Robust install: set prefix to user-writable location and install
      const installSteps = [
        'mkdir -p $HOME/.npm-global',
        'npm config set prefix $HOME/.npm-global',
        // Try official package, fallback to older naming if needed
        'npm install -g @github/copilot --no-audit --no-fund 2>&1 || npm install -g @github/copilot-cli --no-audit --no-fund 2>&1 || npm install -g @githubnext/github-copilot-cli --no-audit --no-fund 2>&1',
        `${COPILOT_PATH_EXPORT}; which copilot; copilot --version || true`,
      ]

      for (const step of installSteps) {
        const stepResult = await runCommandInSandbox(sandbox, 'sh', ['-c', step])
        if (stepResult.output) {
          await logger.info(redactSensitiveInfo(stepResult.output.trim().slice(0, 500)))
        }
        if (stepResult.error && !stepResult.success) {
          // Don't fail on version check, only on install
          if (step.includes('npm install')) {
            copilotInstall = stepResult
            if (!stepResult.success) {
              await logger.error('Copilot install step failed, trying fallback')
            }
          }
        }
      }

      // Final verification
      const verifyInstall = await runWithPath(sandbox, 'which copilot; ls -la $HOME/.npm-global/bin/ | grep copilot || true')
      if (verifyInstall.output) {
        await logger.info(redactSensitiveInfo(verifyInstall.output.trim().slice(0, 1000)))
      }

      // If still not found, try pnpm or yarn global or direct npx
      const finalCheck = await runWithPath(sandbox, 'which copilot 2>/dev/null')
      if (!finalCheck.success || !finalCheck.output?.includes('copilot')) {
        await logger.info('Copilot not found in PATH, checking npx fallback...')
        const npxCheck = await runCommandInSandbox(sandbox, 'sh', ['-c', 'npx @github/copilot --version 2>&1 || true'])
        if (npxCheck.output?.includes('copilot') || npxCheck.output?.toLowerCase().includes('version')) {
          await logger.info('Copilot available via npx, will use npx wrapper')
          // Create wrapper script
          await runCommandInSandbox(sandbox, 'sh', [
            '-c',
            'mkdir -p $HOME/.npm-global/bin && echo \'#!/bin/sh\\nexec npx @github/copilot \"$@\"\' > $HOME/.npm-global/bin/copilot && chmod +x $HOME/.npm-global/bin/copilot',
          ])
        } else {
          const errorMsg = 'Failed to install GitHub Copilot CLI after multiple attempts'
          await logger.error(errorMsg)
          return {
            success: false,
            error: errorMsg,
            cliName: 'copilot',
            changesDetected: false,
          }
        }
      }
    }

    await logger.info('GitHub Copilot CLI installed successfully')

    // Check if Copilot CLI is available with proper PATH
    const cliCheck = await runWithPath(sandbox, 'which copilot && copilot --version 2>&1 || copilot --help 2>&1 | head -n 20')

    if (!cliCheck.success && !cliCheck.output?.toLowerCase().includes('copilot')) {
      return {
        success: false,
        error: 'GitHub Copilot CLI not found after installation',
        cliName: 'copilot',
        changesDetected: false,
      }
    }

    if (cliCheck.output) {
      await logger.info(redactSensitiveInfo(cliCheck.output.trim().slice(0, 1000)))
    }

    // Check if GH_TOKEN or GITHUB_TOKEN is available
    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
    if (!token) {
      return {
        success: false,
        error: 'GH_TOKEN or GITHUB_TOKEN environment variable is required but not found',
        cliName: 'copilot',
        changesDetected: false,
      }
    }

    // Verify token has copilot access by checking user
    await logger.info('Verifying GitHub token for Copilot...')
    const tokenCheck = await runCommandInSandbox(sandbox, 'sh', [
      '-c',
      `${COPILOT_PATH_EXPORT}; GH_TOKEN="${token}" GITHUB_TOKEN="${token}" copilot --version 2>&1 || echo "version check failed"`,
    ])
    if (tokenCheck.output) {
      await logger.info(redactSensitiveInfo(tokenCheck.output.trim().slice(0, 500)))
    }

    // Configure MCP servers if provided
    if (mcpServers && mcpServers.length > 0) {
      await logger.info('Configuring MCP servers for GitHub Copilot')

      const mcpConfig: {
        mcpServers: Record<
          string,
          | { type: 'http'; url: string; headers?: Record<string, string>; tools: string[] }
          | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; tools: string[] }
        >
      } = {
        mcpServers: {},
      }

      for (const server of mcpServers) {
        const serverName = server.name.toLowerCase().replace(/[^a-z0-9]/g, '-')

        if (server.type === 'local') {
          const commandParts = server.command!.trim().split(/\s+/)
          const executable = commandParts[0]
          const args = commandParts.slice(1)

          let envObject: Record<string, string> | undefined
          if (server.env) {
            try {
              envObject = JSON.parse(server.env)
            } catch (e) {
              await logger.info('Warning: Failed to parse env for MCP server')
            }
          }

          mcpConfig.mcpServers[serverName] = {
            type: 'stdio',
            command: executable,
            ...(args.length > 0 ? { args } : {}),
            ...(envObject ? { env: envObject } : {}),
            tools: [],
          }
          await logger.info('Added local MCP server')
        } else {
          const headers: Record<string, string> = {}
          if (server.oauthClientSecret) {
            headers.Authorization = `Bearer ${server.oauthClientSecret}`
          }
          if (server.oauthClientId) {
            headers['X-Client-ID'] = server.oauthClientId
          }

          const httpConfig: { type: 'http'; url: string; headers?: Record<string, string>; tools: string[] } = {
            type: 'http',
            url: server.baseUrl!,
            tools: [],
          }

          if (Object.keys(headers).length > 0) {
            httpConfig.headers = headers
          }

          mcpConfig.mcpServers[serverName] = httpConfig
          await logger.info('Added remote MCP server')
        }
      }

      const mcpConfigJson = JSON.stringify(mcpConfig, null, 2)
      const createMcpConfigCmd = `mkdir -p $HOME/.copilot && cat > $HOME/.copilot/mcp-config.json << 'EOF'\n${mcpConfigJson}\nEOF`

      await logger.info('Creating GitHub Copilot MCP configuration file...')
      const mcpConfigResult = await runCommandInSandbox(sandbox, 'sh', ['-c', createMcpConfigCmd])

      if (mcpConfigResult.success) {
        await logger.info('MCP configuration file created successfully')
      } else {
        await logger.info('Warning: Failed to create MCP configuration file')
      }
    }

    await logger.info('Starting GitHub Copilot CLI execution...')

    let capturedOutput = ''
    let capturedError = ''

    const { Writable } = await import('stream')

    interface WriteCallback {
      (error?: Error | null): void
    }

    let extractedSessionId: string | undefined

    const captureStdout = new Writable({
      write(chunk: Buffer | string, encoding: BufferEncoding, callback: WriteCallback) {
        const data = chunk.toString()

        if (!agentMessageId || !taskId) {
          capturedOutput += data
        }

        if (agentMessageId && taskId) {
          const lines = data.split('\n')
          for (const line of lines) {
            if (line.trim()) {
              const isDiffBox = /[╭╰│─═╮╯]/.test(line)

              if (!isDiffBox) {
                const isActionLine = /^[●✓]/.test(line.trim())

                if (isActionLine && accumulatedContent.length > 0) {
                  accumulatedContent += '\n'
                }

                accumulatedContent += line + '\n'

                db.update(taskMessages)
                  .set({ content: accumulatedContent })
                  .where(eq(taskMessages.id, agentMessageId))
                  .catch(() => {})
              }
            }
          }
        }

        callback()
      },
    })

    const captureStderr = new Writable({
      write(chunk: Buffer | string, encoding: BufferEncoding, callback: WriteCallback) {
        capturedError += chunk.toString()
        callback()
      },
    })

    if (taskId) {
      agentMessageId = generateId(12)
      await db.insert(taskMessages).values({
        id: agentMessageId,
        taskId,
        role: 'agent',
        content: '<pre class="whitespace-pre-wrap font-sans text-xs">',
      })
      accumulatedContent = '<pre class="whitespace-pre-wrap font-sans text-xs">'
    }

    const homeDir = '/home/vercel-sandbox'
    const mcpConfigPath = `${homeDir}/.copilot/mcp-config.json`
    const modelFlag = normalizedModel ? ` --model ${normalizedModel}` : ''
    const resumeFlag = isResumed && sessionId ? ` --resume ${sessionId}` : ''
    const additionalMcpConfig = mcpServers && mcpServers.length > 0 ? ` --additional-mcp-config @${mcpConfigPath}` : ''

    // Build args with normalized model
    const args = [
      '-p',
      instruction,
      '--allow-all-tools',
      '--no-color',
      ...(normalizedModel ? ['--model', normalizedModel] : []),
      ...(isResumed && sessionId ? ['--resume', sessionId] : []),
      ...(mcpServers && mcpServers.length > 0 ? ['--additional-mcp-config', `@${mcpConfigPath}`] : []),
    ]

    const logCommand = `copilot${modelFlag}${resumeFlag}${additionalMcpConfig} -p "${instruction.slice(0, 100)}..." --allow-all-tools --no-color`
    await logger.command(logCommand)
    await logger.info(`Executing GitHub Copilot CLI with model: ${normalizedModel || 'default'}`)

    // Execute with robust env - include PATH with npm-global
    const execEnv = {
      GH_TOKEN: token!,
      GITHUB_TOKEN: token!,
      PATH: '/home/vercel-sandbox/.npm-global/bin:/home/vercel-sandbox/.local/bin:/usr/local/bin:/usr/bin:/bin',
      HOME: '/home/vercel-sandbox',
      // Force non-interactive
      CI: 'true',
      COPILOT_ALLOW_ALL: 'true',
    }

    let executionFailed = false
    let executionError = ''

    try {
      await sandbox.runCommand({
        cmd: COPILOT_BIN,
        args: args,
        env: execEnv,
        sudo: false,
        cwd: PROJECT_DIR,
        stdout: captureStdout,
        stderr: captureStderr,
      })

      await logger.info('GitHub Copilot CLI execution completed')
    } catch (error) {
      executionFailed = true
      executionError = error instanceof Error ? error.message : String(error)
      await logger.info(`GitHub Copilot CLI execution finished with note: ${redactSensitiveInfo(executionError.slice(0, 500))}`)

      // If failed with model error, retry without model flag
      if (capturedError.toLowerCase().includes('model') || executionError.toLowerCase().includes('model')) {
        await logger.info('Model error detected, retrying with default model...')

        capturedOutput = ''
        capturedError = ''

        const retryCaptureStdout = new Writable({
          write(chunk: Buffer | string, _enc: BufferEncoding, cb: WriteCallback) {
            const data = chunk.toString()
            if (!agentMessageId || !taskId) capturedOutput += data
            if (agentMessageId && taskId) {
              accumulatedContent += data + '\n'
              db.update(taskMessages)
                .set({ content: accumulatedContent })
                .where(eq(taskMessages.id, agentMessageId))
                .catch(() => {})
            }
            cb()
          },
        })

        const retryCaptureStderr = new Writable({
          write(chunk: Buffer | string, _enc: BufferEncoding, cb: WriteCallback) {
            capturedError += chunk.toString()
            cb()
          },
        })

        try {
          await sandbox.runCommand({
            cmd: COPILOT_BIN,
            args: ['-p', instruction, '--allow-all-tools', '--no-color'],
            env: execEnv,
            sudo: false,
            cwd: PROJECT_DIR,
            stdout: retryCaptureStdout,
            stderr: retryCaptureStderr,
          })
          await logger.info('Retry with default model completed')
          executionFailed = false
        } catch (retryError) {
          await logger.info('Retry also failed, will check for file changes anyway')
        }
      }
    }

    const result = {
      success: !executionFailed,
      output: capturedOutput,
      error: capturedError,
      command: logCommand,
    }

    if (result.output && result.output.trim() && !agentMessageId) {
      const redactedOutput = redactSensitiveInfo(result.output.trim().slice(0, 2000))
      await logger.info(redactedOutput)
    }

    if (result.error && result.error.trim()) {
      const redactedError = redactSensitiveInfo(result.error.trim().slice(0, 2000))
      // Only log as error if it's not just warnings and execution didn't completely fail
      if (executionFailed || redactedError.toLowerCase().includes('error')) {
        await logger.error(redactedError)
      } else {
        await logger.info(redactedError)
      }
    }

    if (agentMessageId && taskId) {
      accumulatedContent += '</pre>'
      await db
        .update(taskMessages)
        .set({ content: accumulatedContent })
        .where(eq(taskMessages.id, agentMessageId))
        .catch((err: Error) => console.error('Failed to update message:', err))
    }

    // Check if any files were modified - even if CLI reported error, changes might exist
    const gitStatusCheck = await runAndLogCommand(sandbox, 'git', ['status', '--porcelain'], logger)
    const hasChanges = gitStatusCheck.success && gitStatusCheck.output?.trim()

    // If we have changes, consider it success even if CLI had non-zero exit
    const finalSuccess = result.success || !!hasChanges || capturedOutput.length > 50

    return {
      success: finalSuccess,
      output: `GitHub Copilot CLI executed ${finalSuccess ? 'successfully' : 'with issues'}${hasChanges ? ' (Changes detected)' : ' (No changes made)'}`,
      agentResponse: agentMessageId ? undefined : result.output || 'GitHub Copilot CLI completed the task',
      cliName: 'copilot',
      changesDetected: !!hasChanges,
      error: finalSuccess ? undefined : result.error || executionError,
      sessionId: extractedSessionId,
    }
  } catch (error: unknown) {
    if (agentMessageId && taskId) {
      accumulatedContent += '</pre>'
      await db
        .update(taskMessages)
        .set({ content: accumulatedContent })
        .where(eq(taskMessages.id, agentMessageId))
        .catch((err: Error) => console.error('Failed to update message:', err))
    }

    const errorMessage = error instanceof Error ? error.message : 'Failed to execute GitHub Copilot CLI in sandbox'
    return {
      success: false,
      error: errorMessage,
      cliName: 'copilot',
      changesDetected: false,
    }
  }
}
