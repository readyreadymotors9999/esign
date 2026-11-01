export class DraftHistory<T> {
  private entries: T[];
  index = 0;
  constructor(initial: T) { this.entries = [structuredClone(initial)]; }
  get current() { return structuredClone(this.entries[this.index]); }
  get initial() { return structuredClone(this.entries[0]); }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  record(value: T) {
    if (JSON.stringify(value) === JSON.stringify(this.current)) return false;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push(structuredClone(value));
    this.index++;
    return true;
  }
  at(index: number) {
    if (index < 0 || index >= this.entries.length) throw new Error("Invalid history position");
    return structuredClone(this.entries[index]);
  }
}
