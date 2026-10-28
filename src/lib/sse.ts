/** Reads server-sent events (`data: {json}` and a blank line) from text that arrives in pieces,
 * cut anywhere. */
export class SseReader<T = Record<string, unknown>> {
  private buffer = '';

  constructor(private readonly onEvent: (event: T) => void) {}

  push(chunk: string) {
    this.buffer += chunk.replace(/\r\n?/g, '\n');
    let at: number;
    while ((at = this.buffer.indexOf('\n\n')) !== -1) {
      const block = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 2);
      this.read(block);
    }
  }

  /** Whatever's left when the stream ends. */
  end() {
    if (this.buffer.trim()) this.read(this.buffer);
    this.buffer = '';
  }

  private read(block: string) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
    if (!data) return;
    try {
      this.onEvent(JSON.parse(data) as T);
    } catch {
      // Not ours: a comment, a keep-alive.
    }
  }
}
