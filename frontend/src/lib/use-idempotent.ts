import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "./api";
import { PendingCreates } from "./pending-creates";

export function useIdempotentCreate<Input>(
  token: string, send: (input: Input, key: string) => Promise<object | void>,
  options: { refresh: string[]; success?: (input: Input) => string; onSuccess?: () => void; signature?: (input: Input) => string },
) {
  const client = useQueryClient();
  const pending = useRef(new PendingCreates<Input, object | void>());

  return useMutation({
    mutationFn: (input: Input) => {
      const signature = options.signature?.(input) ?? JSON.stringify(input);

      return pending.current.run(input, signature, send);
    },
    onSuccess: async ({ key }, input) => {
      const signature = options.signature?.(input) ?? JSON.stringify(input);

      pending.current.complete(signature, key);

      await Promise.all(options.refresh.map((name) => client.invalidateQueries({ queryKey: [name, token] })));

      if (options.success) toast.success(options.success(input));
      options.onSuccess?.();
    },
    onError: (error) => toast.error(error.message),
  });
}

export function useIdempotentDelete<Entry extends { id: string; revision: number }>(
  token: string, send: (entry: Entry, key: string) => Promise<object | void>,
  options: { refresh: string[]; success?: (entry: Entry) => string },
) {
  const client = useQueryClient();
  const pending = useRef(new Map<string, string>());
  const refresh = () => Promise.all(options.refresh.map((name) => client.invalidateQueries({ queryKey: [name, token] })));

  return useMutation({
    mutationFn: (entry: Entry) => {
      const key = pending.current.get(entry.id) ?? crypto.randomUUID();
      pending.current.set(entry.id, key);

      return send(entry, key);
    },
    onSuccess: async (_, entry) => {
      pending.current.delete(entry.id);
      await refresh();

      if (options.success) toast.success(options.success(entry));
    },
    onError: (error, entry) => {
      toast.error(error.message);

      if (error instanceof ApiError && error.status === 409) {
        pending.current.delete(entry.id);
        void refresh();
      }
    },
  });
}
