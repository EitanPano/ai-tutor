import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { API_URL, SESSION_COOKIE } from '@/lib/config'
import { buildCsp, newNonce } from '@/lib/csp'
import { DEFAULT_PATH, LOGIN_PATH, isProtectedPath } from '@/lib/route'

// UX only: the backend is the authority on sessions. A stale `sid` cookie passes here and
// is rejected by the first API call, which sends the user to /login.
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const hasSession = request.cookies.has(SESSION_COOKIE)

  if (pathname === '/') {
    return NextResponse.redirect(new URL(hasSession ? DEFAULT_PATH : LOGIN_PATH, request.url))
  }

  if (isProtectedPath(pathname) && !hasSession) {
    const login = new URL(LOGIN_PATH, request.url)
    login.searchParams.set('next', pathname + search)
    return NextResponse.redirect(login)
  }

  // A fresh nonce per request. It travels to the renderer in the request's CSP header, which
  // is how Next finds it; the response carries the same policy to the browser.
  const csp = buildCsp({
    nonce: newNonce(),
    apiUrl: API_URL,
    isDev: process.env.NODE_ENV === 'development'
  })
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('Content-Security-Policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  // Skip Next internals and anything with a file extension (static files, favicon.ico).
  matcher: ['/((?!_next/|.*\\..*).*)']
}
