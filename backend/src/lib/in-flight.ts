/**
 * Registry of the AbortControllers of generations that are running right now. On shutdown the
 * process aborts them all first: each generation then unwinds through its normal path, where
 * `MessageService.finish` persists the `aborted` outcome and releases the generation lock. The
 * registry never persists or releases anything itself.
 */
export class InFlightRegistry {
  private readonly controllers = new Set<AbortController>()
  private closed = false

  /** Tracks `controller`; returns the function that untracks it. Aborts at once after `abortAll`. */
  track(controller: AbortController): () => void {
    if (this.closed) controller.abort()
    else this.controllers.add(controller)
    return () => {
      this.controllers.delete(controller)
    }
  }

  /** Aborts every tracked generation and any tracked afterwards. Returns how many it aborted. */
  abortAll(): number {
    this.closed = true
    const count = this.controllers.size
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
    return count
  }

  get size(): number {
    return this.controllers.size
  }
}
