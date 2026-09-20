export type NativeTimelinePage = {
  events: Array<{ eventId: string; rawEvent: string }>
  hasOlder?: boolean
  hasNewer?: boolean
}

/** Live invalidations are hints. Cursors advance only after a requested page is applied. */
export class NativeTimelinePager {
  private following = false
  private dirty = true
  private running?: Promise<void>
  private newest?: string

  constructor(
    private fetchPage: (after?: string) => Promise<NativeTimelinePage>,
    private applyPage: (page: NativeTimelinePage) => Promise<void>,
  ) {}

  seed(page: NativeTimelinePage) {
    this.newest = page.events.at(-1)?.eventId
  }

  follow(value: boolean) {
    this.following = value
    if (value) this.dirty = true
  }

  refresh(): Promise<void> {
    this.dirty = true
    if (this.running) return this.running
    if (!this.following) return Promise.resolve()
    const run = async () => {
      while (this.following && this.dirty) {
        this.dirty = false
        let more = true
        while (this.following && more) {
          const page = await this.fetchPage(this.newest)
          if (!this.following) {
            this.dirty = true
            return
          }
          await this.applyPage(page)
          const newest = page.events.at(-1)?.eventId
          if (newest) this.newest = newest
          more = !!page.hasNewer
          if (more && !newest) throw new Error('Native timeline page made no progress')
        }
        // Refresh the live window too: decryption, edits and redactions retain event IDs.
        if (this.following) {
          const page = await this.fetchPage()
          if (!this.following) {
            this.dirty = true
            return
          }
          // A newer event may have arrived since the cursor page. Fetch it in sequence.
          if (page.events.at(-1)?.eventId !== this.newest) {
            this.dirty = true
          } else {
            await this.applyPage(page)
          }
        }
      }
    }
    this.running = run().finally(() => {
      this.running = undefined
    })
    return this.running
  }
}
