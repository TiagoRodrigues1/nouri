import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "./api";
import { PendingWrites } from "./pending-writes";

type Refresh<Input> =
  | { refresh: readonly string[] }
  | { refreshFor: (input: Input) => readonly string[] };

// What a saved write tells the person and the page.
type Feedback<Input> = { success?: (input: Input) => string; onSuccess?: (input: Input) => void };

// One key per distinct request, reused while it is retried. Serves creates and edits alike.
export function useIdempotentWrite<Input>(
  send: (input: Input, key: string) => Promise<object | void>,
  options: Refresh<Input> & Feedback<Input> & { signature?: (input: Input) => string },
) {
  const client = useQueryClient();
  const pending = useRef(new PendingWrites<Input, object | void>());

  const refresh = (input: Input) => {
    const names = "refreshFor" in options ? options.refreshFor(input) : options.refresh;

    return Promise.all(names.map((name) => client.invalidateQueries({ queryKey: [name] })));
  };

  return useMutation({
    mutationFn: (input: Input) => {
      const signature = options.signature?.(input) ?? JSON.stringify(input);

      return pending.current.run(input, signature, send);
    },
    onSuccess: async ({ key }, input) => {
      const signature = options.signature?.(input) ?? JSON.stringify(input);

      pending.current.complete(signature, key);

      // The write is saved, so the dialog closes and says so now. The mutation stays pending until the
      // reads come back, which keeps buttons that act on the old revisions disabled meanwhile.
      if (options.success) toast.success(options.success(input));
      options.onSuccess?.(input);

      await refresh(input);
    },
    onError: (error, input) => {
      toast.error(error.message);

      // The record changed or went away, so show what is there now.
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        void refresh(input);
      }
    },
  });
}

export function useIdempotentDelete<Entry extends { id: string; revision: number }>(
  send: (entry: Entry, key: string) => Promise<object | void>,
  options: Refresh<Entry> & Feedback<Entry>,
) {
  return useIdempotentWrite(send, {
    ...options,
    signature: (entry) => JSON.stringify([entry.id, entry.revision]),
  });
}
