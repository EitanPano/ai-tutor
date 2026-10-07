export {}

declare global {
  namespace Express {
    interface Request {
      /** Set by requireSession. Read it through getAuth(req). */
      auth?: { userId: string }
    }
  }
}
