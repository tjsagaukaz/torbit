/**
 * TORBIT - Next.js Middleware
 *
 * Handles Supabase session refresh, route protection, and security headers.
 *
 * RULES:
 * - Only refresh session when auth cookies are present
 * - Keep middleware lightweight (Edge runtime)
 * - No heavy logic here
 */

import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import {
  isE2EAuthenticatedRequest,
} from '@/lib/e2e-auth'
import { assertEnvContract } from '@/lib/env.contract'

assertEnvContract('edge')

// Routes that require authentication
const protectedRoutes = ['/builder', '/dashboard']

// Supabase auth cookie name patterns:
// - sb-<project-ref>-auth-token
// - sb-<project-ref>-auth-token.<chunk-index> (chunked values)
// - optional secure prefixes for some deployments
// Excludes helper cookies like `-auth-token-code-verifier`.
const SUPABASE_AUTH_COOKIE_PATTERNS = [
  /^(?:__Host-|__Secure-)?sb-.+-auth-token$/,
  /^(?:__Host-|__Secure-)?sb-.+-auth-token\.\d+$/,
  /^supabase-auth-token$/,
  /^supabase-auth-token\.\d+$/,
]

function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  )
}

function isSupabaseAuthCookieName(name: string): boolean {
  return SUPABASE_AUTH_COOKIE_PATTERNS.some((pattern) => pattern.test(name))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const isProtectedRoute = matchesRoute(pathname, protectedRoutes)

  // Check if user has any Supabase auth cookies
  const hasSupabaseAuthCookies = request.cookies
    .getAll()
    .some((cookie) => isSupabaseAuthCookieName(cookie.name))
  const hasE2EAuthCookie = isE2EAuthenticatedRequest(request)
  const hasAuthCookies = hasSupabaseAuthCookies || hasE2EAuthCookie

  // Enforce auth on protected routes
  if (isProtectedRoute && !hasAuthCookies) {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Only refresh session if auth cookies exist (reduces auth traffic)
  let response = NextResponse.next({ request })

  if (hasSupabaseAuthCookies) {
    response = await updateSession(request)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api routes (they handle their own auth)
     */
    '/((?!_next/static|_next/image|favicon.ico|public|api).*)',
  ],
}
