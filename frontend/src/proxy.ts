import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { buildCsp, newNonce } from '@/lib/csp'

// UX only: the backend is the authority on sessions. A stale `sid` cookie passes here and
// is rejected by the first API call, which sends the user to /login.
const SESSION_COOKIE = 'sid'
const PROTECTED_PREFIXES = ['/thread', '/guide', '/quiz', '/progress']

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

const isProtected = (pathname: string) =>
  PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const hasSession = request.cookies.has(SESSION_COOKIE)

  if (pathname === '/') {
    return NextResponse.redirect(new URL(hasSession ? '/thread' : '/login', request.url))
  }

  if (isProtected(pathname) && !hasSession) {
    const login = new URL('/login', request.url)
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
