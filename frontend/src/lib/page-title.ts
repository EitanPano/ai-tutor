'use client'

import { useEffect } from 'react'

/** Same suffix as the root layout's title template, which only reaches static metadata. */
const pageTitle = (name: string) => `${name} | AI Tutor`

/**
 * Names the page after what it shows once that is known (a thread, guide or quiz), so the route
 * announcer and history tell two of them apart. Until then the static `metadata` title stands.
 */
export function usePageTitle(name: string | undefined) {
  useEffect(() => {
    if (name) document.title = pageTitle(name)
  }, [name])
}
