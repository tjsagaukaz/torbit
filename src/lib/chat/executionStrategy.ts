import type { AgentId } from '@/lib/tools/definitions'

export type ExecutionStrategy = 'fast_lane' | 'world_class'

export interface ExecutionStrategyResult {
  strategy: ExecutionStrategy
  reason: string
}

const HIGH_RISK_AGENTS = new Set<AgentId>([
  'backend',
  'database',
  'devops',
  'auditor',
])

const HIGH_RISK_PROMPT_PATTERNS = [
  /\bauth\b/i,
  /\bauthentication\b/i,
  /\boauth\b/i,
  /\blogin\b/i,
  /\bsign[\s-]?in\b/i,
  /\bbilling\b/i,
  /\bpayment\b/i,
  /\bstripe\b/i,
  /\bsubscription\b/i,
  /\bcheckout\b/i,
  /\bwebhook\b/i,
  /\bdatabase\b/i,
  /\bmigration\b/i,
  /\bsql\b/i,
  /\bschema\b/i,
  /\bsecret\b/i,
  /\btoken\b/i,
  /\bapi key\b/i,
  /\bsecurity\b/i,
  /\bpermission\b/i,
  /\brbac\b/i,
  /\bdeploy\b/i,
  /\bdeployment\b/i,
  /\binfra\b/i,
  /\binfrastructure\b/i,
  /\bci\/cd\b/i,
  /\bcron\b/i,
  /\bqueue\b/i,
  /\bworker\b/i,
  /\bbackground job\b/i,
  /\bmiddleware\b/i,
  /\bproxy\b/i,
]

export function selectExecutionStrategy(input: {
  agentId: AgentId
  userPrompt: string
  fileCount?: number
}): ExecutionStrategyResult {
  if (HIGH_RISK_AGENTS.has(input.agentId)) {
    return {
      strategy: 'world_class',
      reason: 'high-risk agent route',
    }
  }

  if (input.fileCount && input.fileCount > 150) {
    return {
      strategy: 'world_class',
      reason: 'large workspace context',
    }
  }

  if (input.userPrompt.length > 4000) {
    return {
      strategy: 'world_class',
      reason: 'large request context',
    }
  }

  if (HIGH_RISK_PROMPT_PATTERNS.some((pattern) => pattern.test(input.userPrompt))) {
    return {
      strategy: 'world_class',
      reason: 'high-risk product request',
    }
  }

  return {
    strategy: 'fast_lane',
    reason: 'standard interactive build',
  }
}
