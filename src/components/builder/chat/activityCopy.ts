import type { ToolCall } from './types'

function getStringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getDisplayPath(toolCall: ToolCall): string {
  return getStringArg(toolCall.args.path) || getStringArg(toolCall.args.filePath)
}

function getDisplayName(toolCall: ToolCall, fallback: string): string {
  const displayPath = getDisplayPath(toolCall)
  if (!displayPath) return fallback
  return displayPath.split('/').pop() || fallback
}

function humanizeToolName(name: string): string {
  return name
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .trim()
}

function truncate(value: string, maxLength = 46): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 3)}...`
}

export function getToolCallLabel(toolCall: ToolCall): string {
  const query = getStringArg(toolCall.args.query) || getStringArg(toolCall.args.pattern)

  switch (toolCall.name) {
    case 'think':
      return 'Sketching the approach'
    case 'createFile':
      return `Creating ${getDisplayName(toolCall, 'a new file')}`
    case 'editFile':
    case 'replaceInFile':
      return `Updating ${getDisplayName(toolCall, 'the file')}`
    case 'applyPatch':
      return `Patching ${getDisplayName(toolCall, 'the file')}`
    case 'readFile':
      return `Reading ${getDisplayName(toolCall, 'the current code')}`
    case 'deleteFile':
      return `Removing ${getDisplayName(toolCall, 'an old file')}`
    case 'runTests':
    case 'runE2eCycle':
      return 'Running checks'
    case 'runCommand':
    case 'executeCommand': {
      const command = truncate(getStringArg(toolCall.args.command) || 'a command')
      return `Running ${command}`
    }
    case 'installPackage':
    case 'installDependency': {
      const packageName = getStringArg(toolCall.args.package) || getStringArg(toolCall.args.packages) || getStringArg(toolCall.args.name) || 'dependencies'
      return `Installing ${packageName}`
    }
    case 'searchFiles':
    case 'findInFiles':
      return `Looking for ${query || 'matching code'}`
    case 'listFiles':
    case 'listDirectory': {
      const target = getStringArg(toolCall.args.path) || getStringArg(toolCall.args.directory) || 'the project files'
      return `Scanning ${target}`
    }
    case 'verifyDependencyGraph':
      return 'Checking dependencies'
    default:
      return humanizeToolName(toolCall.name)
  }
}

export function getToolCallHeadline(toolCall: ToolCall): string {
  const label = getToolCallLabel(toolCall)

  switch (toolCall.name) {
    case 'think':
      return `🧠 ${label}`
    case 'createFile':
      return `🧱 ${label}`
    case 'editFile':
    case 'replaceInFile':
    case 'applyPatch':
      return `🛠️ ${label}`
    case 'readFile':
      return `👀 ${label}`
    case 'deleteFile':
      return `🧹 ${label}`
    case 'runTests':
    case 'runE2eCycle':
      return `🧪 ${label}`
    case 'runCommand':
    case 'executeCommand':
      return `💻 ${label}`
    case 'installPackage':
    case 'installDependency':
      return `📦 ${label}`
    case 'searchFiles':
    case 'findInFiles':
      return `🔎 ${label}`
    case 'listFiles':
    case 'listDirectory':
      return `🗂️ ${label}`
    default:
      return `⚙️ ${label}`
  }
}

export function getToolCallDetail(toolCall: ToolCall): string {
  switch (toolCall.name) {
    case 'readFile':
    case 'searchFiles':
    case 'findInFiles':
    case 'listFiles':
    case 'listDirectory':
    case 'think':
      return 'I’m reading what is already in the project so the first change lands cleanly.'
    case 'createFile':
    case 'editFile':
    case 'replaceInFile':
    case 'applyPatch':
    case 'deleteFile':
      return 'I’m in the files now and I’ll keep streaming each meaningful change here.'
    case 'installPackage':
    case 'installDependency':
    case 'runCommand':
    case 'executeCommand':
    case 'runTests':
    case 'runE2eCycle':
    case 'verifyDependencyGraph':
      return 'I’m validating the environment and checking the result before I move on.'
    default:
      return 'I’m moving through the build step by step and will keep the next action visible here.'
  }
}
