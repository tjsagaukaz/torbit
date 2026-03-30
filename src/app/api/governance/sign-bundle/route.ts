import { createHash, createHmac } from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { withAuth } from '@/lib/middleware/auth'

export const runtime = 'nodejs'

const SignBundleRequestSchema = z.object({
  projectId: z.string().uuid(),
  action: z.string().min(1),
  artifactCount: z.number().int().min(0).default(0),
  bundleHash: z.string().optional(),
  approvalRequestId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

function resolveSigningSecret(): string | null {
  const secret = process.env.TORBIT_AUDIT_SIGNING_SECRET || process.env.TORBIT_SIGNING_SECRET
  if (!secret || !secret.trim()) return null
  return secret.trim()
}

export const POST = withAuth(async (request, { user }) => {
  const supabase = await createClient()

  const signingSecret = resolveSigningSecret()
  if (!signingSecret) {
    return NextResponse.json(
      { error: 'Audit signing secret is not configured.' },
      { status: 503 }
    )
  }

  try {
    const body = await request.json()
    const parsed = SignBundleRequestSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      )
    }

    const payload = parsed.data
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id, user_id')
      .eq('id', payload.projectId)
      .single()

    if (projectError || !project) {
      return NextResponse.json({ error: 'Project not found.' }, { status: 404 })
    }

    if (project.user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
    }

    const signedAt = new Date().toISOString()
    const canonicalPayload = JSON.stringify({
      projectId: payload.projectId,
      action: payload.action,
      artifactCount: payload.artifactCount,
      approvalRequestId: payload.approvalRequestId || null,
      metadata: payload.metadata || {},
      signedAt,
      signedBy: user.id,
    })

    const payloadHash = createHash('sha256').update(canonicalPayload).digest('hex')
    const signature = createHmac('sha256', signingSecret).update(payloadHash).digest('hex')
    const keyId = process.env.TORBIT_AUDIT_SIGNING_KEY_ID || 'torbit-default'

    return NextResponse.json({
      success: true,
      signedBundle: {
        action: payload.action,
        artifactCount: payload.artifactCount,
        bundleHash: payload.bundleHash || payloadHash,
        signature,
        algorithm: 'HMAC-SHA256',
        keyId,
        signedAt,
        payloadHash,
        approvalRequestId: payload.approvalRequestId || null,
      },
    })
  } catch (error) {
    console.error('sign-bundle error:', error)
    return NextResponse.json(
      { error: 'Failed to sign bundle.' },
      { status: 500 }
    )
  }
})
