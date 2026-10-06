import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// UX only: the backend is the authority on sessions. A stale `sid` cookie passes here and
// is rejected by the first API call, which sends the user to /login.
const SESSION_COOKIE = 'sid'
const PROTECTED_PREFIXES = ['/thread', '/guide', '/quiz', '/progress']

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

  return NextResponse.next()
}

export const config = {
  // Skip Next internals and anything with a file extension (static files, favicon.ico).
  matcher: ['/((?!_next/|.*\\..*).*)']
}
