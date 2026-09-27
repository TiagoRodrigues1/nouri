import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "./api";
import { PendingWrites } from "./pending-writes";

// One key per distinct request, reused while it is retried. Serves creates and edits alike.
export function useIdempotentWrite<Input>(
  token: string, send: (input: Input, key: string) => Promise<object | void>,
  options: { refresh: string[]; success?: (input: Input) => string; onSuccess?: () => void; signature?: (input: Input) => string },
) {
  const client = useQueryClient();
  const pending = useRef(new PendingWrites<Input, object | void>());
  const refresh = () => Promise.all(options.refresh.map((name) => client.invalidateQueries({ queryKey: [name, token] })));

  return useMutation({
    mutationFn: (input: Input) => {
      const signature = options.signature?.(input) ?? JSON.stringify(input);

      return pending.current.run(input, signature, send);
    },
    onSuccess: async ({ key }, input) => {
      const signature = options.signature?.(input) ?? JSON.stringify(input);

      pending.current.complete(signature, key);

      await refresh();

      if (options.success) toast.success(options.success(input));
      options.onSuccess?.();
    },
    onError: (error) => {
      toast.error(error.message);

      // The record changed or went away, so show what is there now.
      if (error instanceof ApiError && (error.status === 404 || error.status === 409)) {
        void refresh();
      }
    },
  });
}

export function useIdempotentDelete<Entry extends { id: string; revision: number }>(
  token: string, send: (entry: Entry, key: string) => Promise<object | void>,
  options: { refresh: string[]; success?: (entry: Entry) => string },
) {
  return useIdempotentWrite(token, send, {
    ...options,
    signature: (entry) => JSON.stringify([entry.id, entry.revision]),
  });
}
