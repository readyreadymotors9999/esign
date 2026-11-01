// Serializes writes and coalesces drag updates. A revision conflict stops saves
// rather than overwriting another tab's changes.
export class DraftSaver {
  private saved: string;
  private latest: string;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private failure?: Error;
  private revision: number;
  private write: (fields: any, revision: number) => Promise<number>;
  private status: (value: string) => void;
  private onAutosaved?: () => void;
  constructor(
    initial: unknown,
    revision: number,
    write: (fields: any, revision: number) => Promise<number>,
    status: (value: string) => void,
    onAutosaved?: () => void,
  ) {
    this.revision = revision;
    this.write = write;
    this.status = status;
    this.onAutosaved = onAutosaved;
    this.saved = this.latest = JSON.stringify(initial);
  }
  get revisionValue() { return this.revision; }
  get dirty() { return this.latest !== this.saved || !!this.running || !!this.failure; }
  update(fields: unknown) {
    this.latest = JSON.stringify(fields);
    if (!this.dirty) {
      clearTimeout(this.timer); this.timer = undefined;
      this.status("Draft saved");
      return;
    }
    if (this.failure) { this.status(`Draft not saved: ${this.failure.message}`); return; }
    this.status(this.running ? "Saving draft…" : "Unsaved changes · autosaves every 5 minutes");
    if (!this.timer) this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush(true).catch(() => {});
    }, 5 * 60 * 1000);
  }
  async flush(automatic = false): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.running) { await this.running; return this.flush(automatic); }
    if (this.failure) throw this.failure;
    if (!this.dirty) return;
    this.status("Saving draft…");
    this.running = (async () => {
      while (this.latest !== this.saved) {
        const snapshot = this.latest;
        this.revision = await this.write(JSON.parse(snapshot), this.revision);
        this.saved = snapshot;
      }
      this.status("Draft saved");
      if (automatic) this.onAutosaved?.();
    })();
    try { await this.running; }
    catch (error) {
      this.failure = error instanceof Error ? error : new Error("Unable to save draft.");
      this.status(`Draft not saved: ${this.failure.message}`);
      throw this.failure;
    } finally {
      this.running = undefined;
      if (this.latest === this.saved) { clearTimeout(this.timer); this.timer = undefined; }
    }
  }
  async retry() { this.failure = undefined; await this.flush(); }
}
