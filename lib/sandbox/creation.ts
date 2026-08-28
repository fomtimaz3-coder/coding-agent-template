import { Sandbox } from '@vercel/sandbox'
import { validateEnvironmentVariables, createAuthenticatedRepoUrl } from './config'
import { runCommandInSandbox, runInProject, PROJECT_DIR } from './commands'
import { generateId } from '@/lib/utils/id'
import { SandboxConfig, SandboxResult } from './types'
import { redactSensitiveInfo } from '@/lib/utils/logging'
import { TaskLogger } from '@/lib/utils/task-logger'
import { detectPackageManager, installDependencies } from './package-manager'
import { registerSandbox } from './sandbox-registry'
import { createSandboxInstance } from './create-instance'
import { classifySandboxError, formatStructuredError } from '@/lib/utils/sandbox-errors'

async function runAndLogCommand(
  sandbox: Sandbox,
  command: string,
  args: string[],
  logger: TaskLogger,
  cwd?: string,
) {
  const escapeArg = (arg: string) => `'${arg.replace(/'/g, "'\\''")}'`
  const fullCommand = args.length > 0 ? `${command} ${args.map(escapeArg).join(' ')}` : command
  await logger.command(redactSensitiveInfo(fullCommand))
  const result = cwd
    ? await runCommandInSandbox(sandbox, 'sh', ['-c', `cd ${cwd} && ${fullCommand}`])
    : await runCommandInSandbox(sandbox, command, args)
  if (result?.output?.trim()) await logger.info(redactSensitiveInfo(result.output.trim()))
  if (result && !result.success && result.error) await logger.error(redactSensitiveInfo(result.error))
  return result
}

export async function createSandbox(config: SandboxConfig, logger: TaskLogger): Promise<SandboxResult> {
  try {
    await logger.info('Processing repository URL')

    if (config.onCancellationCheck && (await config.onCancellationCheck())) {
      await logger.info('Task was cancelled before sandbox creation')
      return { success: false, cancelled: true }
    }

    if (config.onProgress) await config.onProgress(20, 'Validating environment variables...')

    const envValidation = validateEnvironmentVariables(config.selectedAgent, config.githubToken, config.apiKeys)
    if (!envValidation.valid) throw new Error(envValidation.error!)
    await logger.info('Environment variables validated')

    const authenticatedRepoUrl = createAuthenticatedRepoUrl(config.repoUrl, config.githubToken)
    await logger.info('Added GitHub authentication to repository URL')

    const defaultTimeoutMs = 5 * 60 * 1000
    const maxTimeoutMs = 45 * 60 * 1000
    const timeoutMatch = config.timeout?.trim().match(/^(\d+)(?:\s*m(?:in(?:ute)?s?)?)?$/i)
    const requestedTimeoutMinutes = timeoutMatch ? Number(timeoutMatch[1]) : NaN
    const timeoutMs =
      Number.isFinite(requestedTimeoutMinutes) && requestedTimeoutMinutes > 0
        ? Math.min(requestedTimeoutMinutes * 60 * 1000, maxTimeoutMs)
        : defaultTimeoutMs

    const defaultPorts = config.ports || [3000, 5173]
    const sandboxConfig = {
      teamId: process.env.SANDBOX_VERCEL_TEAM_ID!,
      projectId: process.env.SANDBOX_VERCEL_PROJECT_ID!,
      token: process.env.SANDBOX_VERCEL_TOKEN!,
      timeout: timeoutMs,
      ports: defaultPorts,
      runtime: config.runtime || 'node22',
      resources: { vcpus: config.resources?.vcpus || 4 },
    }

    if (config.onProgress) await config.onProgress(25, 'Validating configuration...')

    let sandbox: Sandbox
    try {
      sandbox = await createSandboxInstance(sandboxConfig, logger)
      await logger.info('Sandbox created successfully')
      registerSandbox(config.taskId, sandbox, config.keepAlive || false)

      if (config.onCancellationCheck && (await config.onCancellationCheck())) {
        await logger.info('Task was cancelled after sandbox creation')
        return { success: false, cancelled: true }
      }

      await logger.info('Cloning repository to project directory...')
      const mkdirResult = await runCommandInSandbox(sandbox, 'mkdir', ['-p', PROJECT_DIR])
      if (!mkdirResult.success) throw new Error('Failed to create project directory')

      const cloneResult = await runCommandInSandbox(sandbox, 'git', [
        'clone',
        '--depth',
        '1',
        authenticatedRepoUrl,
        PROJECT_DIR,
      ])
      if (!cloneResult.success) {
        await logger.error('Failed to clone repository')
        throw new Error('Failed to clone repository to project directory')
      }
      await logger.info('Repository cloned successfully')
      if (config.onProgress) await config.onProgress(30, 'Repository cloned, installing dependencies...')
    } catch (error: unknown) {
      const classified = classifySandboxError(error)
      await logger.logStructuredError(classified, 'Sandbox.create')
      await logger.error(formatStructuredError(classified))
      throw new Error(classified.message)
    }

    if (config.installDependencies !== false) {
      await logger.info('Detecting project type and installing dependencies...')
      const packageJsonCheck = await runInProject(sandbox, 'test', ['-f', 'package.json'])
      if (packageJsonCheck.success) {
        const packageManager = await detectPackageManager(sandbox, logger)
        if (config.onProgress) await config.onProgress(35, 'Installing Node.js dependencies...')
        const installResult = await installDependencies(sandbox, packageManager, logger)
        if (!installResult.success && packageManager !== 'npm') {
          await logger.info('Package manager failed, trying npm as fallback')
          await installDependencies(sandbox, 'npm', logger)
        }
      } else {
        await logger.info('No package.json found, skipping dependency installation')
      }
    } else {
      await logger.info('Skipping dependency installation as requested by user')
    }

    if (config.onCancellationCheck && (await config.onCancellationCheck())) {
      await logger.info('Task was cancelled before Git configuration')
      return { success: false, cancelled: true }
    }

    const gitName = config.gitAuthorName || 'Coding Agent'
    const gitEmail = config.gitAuthorEmail || 'agent@example.com'
    await runInProject(sandbox, 'git', ['config', 'user.name', gitName])
    await runInProject(sandbox, 'git', ['config', 'user.email', gitEmail])

    let branchName: string
    if (config.preDeterminedBranchName) {
      await logger.info('Using pre-determined branch name')
      const createBranch = await runAndLogCommand(
        sandbox,
        'git',
        ['checkout', '-b', config.preDeterminedBranchName],
        logger,
        PROJECT_DIR,
      )
      if (!createBranch.success) {
        await runAndLogCommand(sandbox, 'git', ['checkout', config.preDeterminedBranchName], logger, PROJECT_DIR)
      }
      branchName = config.preDeterminedBranchName
    } else {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
      branchName = `agent/${timestamp}-${generateId()}`
      await logger.info('No predetermined branch name, using timestamp-based branch')
      const createBranch = await runAndLogCommand(sandbox, 'git', ['checkout', '-b', branchName], logger, PROJECT_DIR)
      if (!createBranch.success) throw new Error('Failed to create Git branch')
    }

    const domain = sandbox.domain(config.ports?.[0] || 3000)
    await logger.info('Sandbox available')

    return { success: true, sandbox, domain, branchName }
  } catch (error: unknown) {
    const classified = classifySandboxError(error)
    console.error(`Sandbox creation error: ${formatStructuredError(classified)}`)
    await logger.logStructuredError(classified, 'createSandbox')
    await logger.error(redactSensitiveInfo(formatStructuredError(classified)))
    await logger.error('Error occurred during sandbox creation')
    return { success: false, error: classified.message || 'Failed to create sandbox' }
  }
}
