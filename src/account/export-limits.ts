import { day, limited, mib, minute, type UsageWindows } from "../request-limits.js";

// Admission and stream lifetime have one owner: callers cannot forget to release an export slot.
export function accountExports(consume: UsageWindows) {
  const exporting = new Set<string>();

  return (userId: string, source: () => ReadableStream<Uint8Array>): Response | ReadableStream<Uint8Array> => {
    if (exporting.size >= 2 || exporting.has(userId)) return limited("An export is already running. Try again shortly.", 60);

    if (!consume.reserve([
      { key: `export-minute:${userId}`, maximum: 1, duration: minute },
      { key: `exports:${userId}`, maximum: 3, duration: day },
      { key: "exports", maximum: 20, duration: day },
    ])) return limited("Data export limit reached. Try again later.", 3600);
    exporting.add(userId);

    try {
      return boundedExport(source(), () => { exporting.delete(userId); });
    } catch (failure) {
      exporting.delete(userId);
      throw failure;
    }
  };
}

// Hold the export slot until its stream finishes or is cancelled, not just until the HTTP handler returns.
export function boundedExport(source: ReadableStream<Uint8Array>, release: () => void, timeoutMs = 120_000): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let finished = false;
  let bytes = 0;
  let timer: ReturnType<typeof setTimeout>;

  async function finish(cancel: boolean) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);

    try {
      if (cancel) await reader.cancel();
    } finally {
      release();
    }
  }

  return new ReadableStream({
    start(controller) {
      timer = setTimeout(() => {
        if (finished) return;
        controller.error(new Error("Data export timed out"));
        void finish(true).catch(() => undefined);
      }, timeoutMs);
      timer.unref();
    },
    async pull(controller) {
      try {
        const next = await reader.read();

        if (finished) return;

        if (next.done) {
          await finish(false);
          controller.close();

          return;
        }

        bytes += next.value.byteLength;

        if (bytes > 512 * mib) throw new Error("Data export exceeds its size allowance");
        controller.enqueue(next.value);
      } catch (failure) {
        if (!finished) controller.error(failure);
        await finish(true).catch(() => undefined);
      }
    },
    async cancel() { await finish(true); },
  });
}
