import { redirect } from 'next/navigation'

// `proxy.ts` sends `/` to /thread or /login by cookie; this is the fallback when it did not run.
export default function Home() {
  redirect('/thread')
}
