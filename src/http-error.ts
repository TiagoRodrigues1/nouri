import { z } from "zod";

export const errorSchema = z.object({ error: z.string() });

export function error(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
