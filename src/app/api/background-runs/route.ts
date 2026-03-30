import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { makeApiErrorEnvelope } from '@/lib/api/error-envelope'

export const runtime = 'nodejs'

const CreateBackgroundRunSchema = z.object({
  projectId: z.string().uuid(),
  runType: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional(),
  retryable: z.boolean().optional(),
})

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

function isBackgroundRunsUnavailable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = error.code || ''
  const message = (error.message || '').toLowerCase()
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    message.includes('background_runs') ||
    message.includes('schema cache')
  )
}

function isMissingRowError(code: string | undefined): boolean {
  return code === 'PGRST116'
}

async function ensureProjectExistsForRun(
  supabase: SupabaseClient<Database>,
  input: { projectId: string; userId: string; runType: string }
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { projectId, userId, runType } = input

  if (!isUuid(projectId)) {
    return { ok: false, status: 400, error: 'Invalid projectId format. Expected UUID.' }
  }

  const { data: existingProject, error: existingProjectError } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle()

  if (existingProjectError && !isMissingRowError(existingProjectError.code)) {
    return { ok: false, status: 500, error: existingProjectError.message }
  }

  if (existingProject) {
    return { ok: true }
  }

  const inferredProjectType = runType === 'mobile-release' ? 'mobile' : 'web'
  const { error: createProjectError } = await supabase
    .from('projects')
    .insert({
      id: projectId,
      user_id: userId,
      name: 'Torbit Session',
      project_type: inferredProjectType,
      description: 'Auto-created for background run orchestration.',
    })

  if (createProjectError) {
    if (createProjectError.code === '23505') {
      return { ok: true }
    }
    if (createProjectError.code === '23503') {
      return {
        ok: false,
        status: 409,
        error: 'Profile row is missing for this account. Complete auth bootstrap and retry.',
      }
    }
    return { ok: false, status: 500, error: createProjectError.message }
  }

  return { ok: true }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      makeApiErrorEnvelope({
        code: 'UNAUTHORIZED',
        message: 'Unauthorized. Please log in.',
      }),
      { status: 401 }
    )
  }

  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('projectId')
  const statusParam = searchParams.get('status')
  const limit = Number.parseInt(searchParams.get('limit') || '50', 10)
  const status = (
    statusParam === 'queued' ||
    statusParam === 'running' ||
    statusParam === 'succeeded' ||
    statusParam === 'failed' ||
    statusParam === 'cancelled'
  ) ? statusParam : null

  if (projectId && !isUuid(projectId)) {
    return NextResponse.json({
      success: true,
      runs: [],
      warning: 'Ignored invalid projectId filter (expected UUID).',
    })
  }

  let query = supabase
    .from('background_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(Number.isNaN(limit) ? 50 : Math.min(Math.max(limit, 1), 200))

  if (projectId) {
    query = query.eq('project_id', projectId)
  }

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    if (isBackgroundRunsUnavailable(error)) {
      return NextResponse.json({
        success: true,
        runs: [],
        degraded: true,
        warning: 'Background runs table is unavailable. Returning empty run list.',
      })
    }
    return NextResponse.json(
      makeApiErrorEnvelope({
        code: 'BACKGROUND_RUNS_QUERY_FAILED',
        message: error.message,
        retryable: true,
      }),
      { status: 500 }
    )
  }

  return NextResponse.json({ success: true, runs: data || [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json(
      makeApiErrorEnvelope({
        code: 'UNAUTHORIZED',
        message: 'Unauthorized. Please log in.',
      }),
      { status: 401 }
    )
  }

  try {
    const body = await request.json()
    const parsed = CreateBackgroundRunSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        makeApiErrorEnvelope({
          code: 'INVALID_REQUEST',
          message: 'Invalid request',
          details: {
            fields: parsed.error.flatten().fieldErrors,
          },
        }),
        { status: 400 }
      )
    }

    const payload = parsed.data
    const projectCheck = await ensureProjectExistsForRun(supabase as SupabaseClient<Database>, {
      projectId: payload.projectId,
      userId: user.id,
      runType: payload.runType,
    })
    if (!projectCheck.ok) {
      return NextResponse.json(
        makeApiErrorEnvelope({
          code: projectCheck.status === 409 ? 'PROJECT_BOOTSTRAP_REQUIRED' : projectCheck.status === 400 ? 'INVALID_PROJECT_ID' : 'PROJECT_LOOKUP_FAILED',
          message: projectCheck.error,
          retryable: projectCheck.status >= 500,
        }),
        { status: projectCheck.status }
      )
    }

    if (payload.idempotencyKey) {
      const { data: existingRun, error: existingRunError } = await supabase
        .from('background_runs')
        .select('*')
        .eq('project_id', payload.projectId)
        .eq('user_id', user.id)
        .eq('run_type', payload.runType)
        .eq('idempotency_key', payload.idempotencyKey)
        .maybeSingle()

      if (existingRunError) {
        if (isBackgroundRunsUnavailable(existingRunError)) {
          return NextResponse.json({
            success: false,
            degraded: true,
            error: {
              code: 'BACKGROUND_RUNS_UNAVAILABLE',
              message: 'Background runs queue is unavailable; fallback pipeline should continue.',
              retryable: true,
            },
          })
        }
        return NextResponse.json(
          makeApiErrorEnvelope({
            code: 'BACKGROUND_RUNS_LOOKUP_FAILED',
            message: existingRunError.message,
            retryable: true,
          }),
          { status: 500 }
        )
      }

      if (existingRun) {
        return NextResponse.json({ success: true, deduplicated: true, run: existingRun })
      }
    }

    const { data, error } = await supabase
      .from('background_runs')
      .insert({
        project_id: payload.projectId,
        user_id: user.id,
        run_type: payload.runType,
        status: 'queued',
        progress: 0,
        input: (payload.input || {}) as Json,
        metadata: (payload.metadata || {}) as Json,
        idempotency_key: payload.idempotencyKey || null,
        max_attempts: payload.maxAttempts || 3,
        retryable: payload.retryable !== false,
        attempt_count: 0,
        cancel_requested: false,
      })
      .select('*')
      .single()

    if (error) {
      if (isBackgroundRunsUnavailable(error)) {
        return NextResponse.json({
          success: false,
          degraded: true,
          error: {
            code: 'BACKGROUND_RUNS_UNAVAILABLE',
            message: 'Background runs queue is unavailable; fallback pipeline should continue.',
            retryable: true,
          },
        })
      }
      return NextResponse.json(
        makeApiErrorEnvelope({
          code: 'BACKGROUND_RUNS_INSERT_FAILED',
          message: error.message,
          retryable: true,
        }),
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, run: data }, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      makeApiErrorEnvelope({
        code: 'BACKGROUND_RUNS_CREATE_FAILED',
        message: error instanceof Error ? error.message : 'Failed to create background run.',
        retryable: true,
      }),
      { status: 500 }
    )
  }
}
