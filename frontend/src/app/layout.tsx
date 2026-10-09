import type { Metadata } from 'next'
import { Atkinson_Hyperlegible_Mono, Atkinson_Hyperlegible_Next } from 'next/font/google'
import { connection } from 'next/server'
import { Providers } from './providers'
import './globals.css'

// `fallback` is explicit because Next has no size-adjust metrics for these families: without it,
// every compile warns "Failed to find font override values" (`adjustFontFallback: false` does not
// stop the lookup under Turbopack). The font variables carry the whole stack; globals.css uses them.
const sans = Atkinson_Hyperlegible_Next({
  subsets: ['latin'],
  weight: ['400', '600', '800'],
  variable: '--font-atkinson-next',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
  display: 'swap'
})

const mono = Atkinson_Hyperlegible_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-atkinson-mono',
  fallback: ['ui-monospace', 'Cascadia Code', 'monospace'],
  display: 'swap'
})

export const metadata: Metadata = {
  title: { default: 'AI Tutor', template: '%s | AI Tutor' },
  description: 'Ask a coding question and get a guided, step-by-step answer.'
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Every page renders per request so Next can stamp the CSP nonce from src/proxy.ts on its
  // scripts; a statically prerendered page has no nonce and its scripts would be blocked.
  await connection()
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
