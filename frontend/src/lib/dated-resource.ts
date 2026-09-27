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
  function useDatedQuery(token: string, date: string) {
    return useQuery({
      queryKey: [name, token, date],
      queryFn: () => request(token, `${path}/${date}`, schema),
      enabled: Boolean(token),
    });
  }

  function useSaveDated(token: string, date: string) {
    const client = useQueryClient();

    return useMutation({
      mutationFn: (input: Input) => request(token, `${path}/${date}`, schema, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.body ? options.body(input) : input),
      }),
      onSuccess: () => Promise.all([name, ...options.refresh ?? []].map((key) =>
        client.invalidateQueries({ queryKey: [key, token] }))),
    });
  }

  return { useDatedQuery, useSaveDated };
}
