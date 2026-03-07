/**
 * Middleware Tests
 * 
 * Tests session refresh logic and route protection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

// Mock the updateSession function
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: vi.fn(() => NextResponse.next()),
}))

describe('Middleware', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  describe('Session Refresh Logic', () => {
    it('should only refresh session when auth cookies exist', async () => {
      const { updateSession } = await import('@/lib/supabase/middleware')
      
      // Request without auth cookies
      const requestWithoutCookies = new NextRequest('http://localhost:3000/')
      
      // Import and call middleware
      const { middleware } = await import('../middleware')
      await middleware(requestWithoutCookies)
      
      // Should NOT call updateSession when no auth cookies
      expect(updateSession).not.toHaveBeenCalled()
    })

    it('should refresh session when auth cookies are present', async () => {
      const { updateSession } = await import('@/lib/supabase/middleware')
      
      // Request with auth cookies
      const requestWithCookies = new NextRequest('http://localhost:3000/', {
        headers: {
          cookie: 'sb-test-auth-token=test-value',
        },
      })
      
      const { middleware } = await import('../middleware')
      await middleware(requestWithCookies)
      
      // Should call updateSession when auth cookies present
      expect(updateSession).toHaveBeenCalled()
    })
  })

  describe('Auth Route Access', () => {
    it('should allow users with auth cookies to access /login', async () => {
      const request = new NextRequest('http://localhost:3000/login', {
        headers: {
          cookie: 'sb-test-auth-token=test-value',
        },
      })

      const { middleware } = await import('../middleware')
      const response = await middleware(request)

      expect(response.status).not.toBe(307)
    })

    it('should allow unauthenticated users to access /login', async () => {
      const request = new NextRequest('http://localhost:3000/login')

      const { middleware } = await import('../middleware')
      const response = await middleware(request)

      expect(response.status).not.toBe(307)
    })
  })

  describe('Protected Route Redirects', () => {
    it('should redirect unauthenticated users away from /builder', async () => {
      const request = new NextRequest('http://localhost:3000/builder')

      const { middleware } = await import('../middleware')
      const response = await middleware(request)

      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('/login')
      expect(response.headers.get('location')).toContain('next=%2Fbuilder')
    })

    it('should allow authenticated users to access /builder', async () => {
      const request = new NextRequest('http://localhost:3000/builder', {
        headers: {
          cookie: 'sb-test-auth-token=test-value',
        },
      })

      const { middleware } = await import('../middleware')
      const response = await middleware(request)

      expect(response.status).not.toBe(307)
    })
  })

  describe('Cookie Detection', () => {
    it('should detect sb-*-auth-token cookies', async () => {
      // This tests session refresh behavior for auth cookies.
      const cookies = [
        'sb-projectid-auth-token=value',
        'sb-abc123-auth-token=value',
        'sb-test-auth-token=value',
      ]
      
      for (const cookie of cookies) {
        const request = new NextRequest('http://localhost:3000/login', {
          headers: { cookie },
        })
        
        const { middleware } = await import('../middleware')
        const response = await middleware(request)
        
        // Should not redirect from login, but session refresh should run.
        expect(response.status).not.toBe(307)
      }
    })

    it('should not detect non-auth cookies', async () => {
      const cookies = [
        'sb-analytics=value',
        'some-other-cookie=value',
        '_ga=value',
      ]
      
      for (const cookie of cookies) {
        vi.resetModules()
        
        const request = new NextRequest('http://localhost:3000/login', {
          headers: { cookie },
        })
        
        const { middleware } = await import('../middleware')
        const response = await middleware(request)
        
        // Should not redirect (no auth cookie)
        expect(response.status).not.toBe(307)
      }
    })

    it('should not treat code-verifier cookies as authenticated session cookies', async () => {
      const request = new NextRequest('http://localhost:3000/builder', {
        headers: {
          cookie: 'sb-project-auth-token-code-verifier=pkce-value',
        },
      })

      const { middleware } = await import('../middleware')
      const response = await middleware(request)

      // No real auth cookie present, so protected route should redirect to login.
      expect(response.status).toBe(307)
      expect(response.headers.get('location')).toContain('/login')
    })

    it('should detect chunked and prefixed auth token cookies', async () => {
      const cookieVariants = [
        'sb-project-auth-token.0=value',
        '__Secure-sb-project-auth-token=value',
        '__Host-sb-project-auth-token.1=value',
      ]

      for (const cookie of cookieVariants) {
        vi.resetModules()

        const request = new NextRequest('http://localhost:3000/builder', {
          headers: { cookie },
        })

        const { middleware } = await import('../middleware')
        const response = await middleware(request)

        expect(response.status).not.toBe(307)
      }
    })
  })

  describe('E2E Auth Cookie', () => {
    it('should allow protected routes with e2e auth cookie when enabled', async () => {
      process.env.TORBIT_E2E_AUTH = 'true'
      try {
        const request = new NextRequest('http://localhost:3000/builder', {
          headers: { cookie: 'torbit_e2e_auth=1' },
        })

        const { middleware } = await import('../middleware')
        const response = await middleware(request)

        expect(response.status).not.toBe(307)
      } finally {
        delete process.env.TORBIT_E2E_AUTH
      }
    })
  })
})
