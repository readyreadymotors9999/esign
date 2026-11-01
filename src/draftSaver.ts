// Serializes writes and coalesces drag updates. A revision conflict stops saves
// rather than overwriting another tab's changes.
export class DraftSaver {
  private saved: string;
  private latest: string;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<void>;
  private failure?: Error;
  private revision: number;
  private write: (fields: any[], revision: number) => Promise<number>;
  private status: (value: string) => void;
  constructor(
    initial: unknown,
    revision: number,
    write: (fields: any[], revision: number) => Promise<number>,
    status: (value: string) => void,
  ) {
    this.revision = revision;
    this.write = write;
    this.status = status;
    this.saved = this.latest = JSON.stringify(initial);
  }
  get dirty() { return this.latest !== this.saved || !!this.running || !!this.failure; }
  update(fields: unknown) {
    this.latest = JSON.stringify(fields);
    clearTimeout(this.timer);
    if (!this.dirty) return;
    if (this.failure) { this.status(`Draft not saved: ${this.failure.message}`); return; }
    this.status("Saving draft…");
    this.timer = setTimeout(() => { void this.flush().catch(() => {}); }, 600);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) { await this.running; return this.flush(); }
    if (this.failure) throw this.failure;
    if (!this.dirty) return;
    this.running = (async () => {
      while (this.latest !== this.saved) {
        const snapshot = this.latest;
        this.revision = await this.write(JSON.parse(snapshot), this.revision);
        this.saved = snapshot;
      }
      this.status("Draft saved");
    })();
    try { await this.running; }
    catch (error) {
      this.failure = error instanceof Error ? error : new Error("Unable to save draft.");
      this.status(`Draft not saved: ${this.failure.message}`);
      throw this.failure;
    } finally { this.running = undefined; }
  }
  async retry() { this.failure = undefined; await this.flush(); }
}
