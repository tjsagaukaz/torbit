import fs from 'fs'
import path from 'path'

const LOG_DIR = path.resolve(process.cwd(), 'logs')
const LOG_FILE = path.join(LOG_DIR, 'events.log')

export function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })
}

export function appendLog(jsonLine: string) {
  ensureLogDir()
  fs.appendFileSync(LOG_FILE, jsonLine + '\n', { encoding: 'utf8' })
}

export function readLogs() {
  ensureLogDir()
  if (!fs.existsSync(LOG_FILE)) return []
  const content = fs.readFileSync(LOG_FILE, 'utf8')
  return content.split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l) } catch { return { raw: l } }
  })
}
