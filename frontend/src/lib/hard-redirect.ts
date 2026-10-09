/**
 * A full page load of `url` that replaces the current history entry. Unlike `router.replace`, it
 * drops every piece of client state, the query cache included. A module of its own so tests can
 * mock it: jsdom implements no navigation.
 */
export const hardRedirect = (url: string) => window.location.replace(url)
