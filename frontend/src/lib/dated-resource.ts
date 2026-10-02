import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { request } from "./api";

// A full replacement saved from one date onward. Every read and write uses the same response schema.
export function datedResource<Input, Schema extends z.ZodType>(
  path: string,
  name: string,
  schema: Schema,
  options: { refresh?: string[]; body?: (input: Input) => object } = {},
) {
  // `enabled` lets a closed dialog skip the read until it opens.
  function useDatedQuery(date: string, enabled = true) {
    return useQuery({
      queryKey: [name, date],
      queryFn: () => request(`${path}/${date}`, schema),
      enabled,
    });
  }

  function useSaveDated(date: string) {
    const client = useQueryClient();

    return useMutation({
      mutationFn: (input: Input) => request(`${path}/${date}`, schema, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.body ? options.body(input) : input),
      }),
      // Not awaited, so the dialog closes as soon as the value is saved rather than after every read refreshes.
      onSuccess: () => {
        for (const key of [name, ...options.refresh ?? []]) void client.invalidateQueries({ queryKey: [key] });
      },
    });
  }

  return { useDatedQuery, useSaveDated };
}
