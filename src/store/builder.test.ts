import { beforeEach, describe, expect, it } from 'vitest'
import { useBuilderStore } from './builder'

describe('builder store', () => {
  beforeEach(() => {
    useBuilderStore.getState().reset()
    sessionStorage.clear()
  })

  it('initializes a project session with a persisted project id and prompt messages', () => {
    useBuilderStore.getState().initProject('Build a governed dashboard')

    const state = useBuilderStore.getState()
    expect(state.projectId).toBeTruthy()
    expect(sessionStorage.getItem('torbit_project_id')).toBe(state.projectId)
    expect(state.prompt).toBe('Build a governed dashboard')
    expect(state.messages).toHaveLength(2)
    expect(state.messages[0].role).toBe('system')
    expect(state.messages[1]).toMatchObject({
      role: 'user',
      content: 'Build a governed dashboard',
    })
  })

  it('bootstraps the Expo template once when switching to a mobile project', () => {
    const store = useBuilderStore.getState()

    store.setProjectType('mobile')
    const firstPass = useBuilderStore.getState()

    expect(firstPass.projectType).toBe('mobile')
    expect(firstPass.previewDevice).toBe('mobile')
    expect(firstPass.files.length).toBeGreaterThan(0)
    expect(firstPass.files.some((file) => file.path === 'app.config.ts')).toBe(true)

    const initialFileCount = firstPass.files.length
    useBuilderStore.getState().setProjectType('mobile')

    expect(useBuilderStore.getState().files).toHaveLength(initialFileCount)
  })

  it('normalizes duplicate file paths instead of adding a second file', () => {
    const store = useBuilderStore.getState()

    store.addFile({
      path: '/src/app/page.tsx',
      name: 'page.tsx',
      content: 'export default function Page() { return null }',
      language: 'tsx',
    })
    store.addFile({
      path: 'src/app/page.tsx',
      name: 'page.tsx',
      content: 'export default function Page() { return <main /> }',
      language: 'tsx',
    })

    const state = useBuilderStore.getState()
    expect(state.files).toHaveLength(1)
    expect(state.files[0]).toMatchObject({
      path: '/src/app/page.tsx',
      isModified: true,
      auditStatus: 'new',
    })
    expect(state.files[0].content).toContain('<main />')
  })

  it('marks files as reviewed and clears the new flag when audit passes', () => {
    const store = useBuilderStore.getState()

    store.addFile({
      path: 'components/Button.tsx',
      name: 'Button.tsx',
      content: 'export function Button() { return null }',
      language: 'tsx',
    })

    const fileId = useBuilderStore.getState().files[0]?.id
    expect(fileId).toBeTruthy()

    store.setFileAuditStatus(fileId!, 'passed')

    const file = useBuilderStore.getState().files[0]
    expect(file.auditStatus).toBe('passed')
    expect(file.isNew).toBe(false)
  })

  it('clears the active file when that file is deleted', () => {
    const store = useBuilderStore.getState()

    store.addFile({
      path: 'components/Card.tsx',
      name: 'Card.tsx',
      content: 'export function Card() { return null }',
      language: 'tsx',
    })

    const fileId = useBuilderStore.getState().files[0]!.id
    store.setActiveFile(fileId)
    expect(useBuilderStore.getState().previewTab).toBe('code')

    store.deleteFile(fileId)

    expect(useBuilderStore.getState().activeFileId).toBeNull()
    expect(useBuilderStore.getState().files).toHaveLength(0)
  })
})
