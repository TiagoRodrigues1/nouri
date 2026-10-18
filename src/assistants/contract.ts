import { z } from "zod";

// An assistant the person let into Nouri through Clerk's consent page, such as Claude or ChatGPT.
export const assistantSchema = z.object({
  clientId: z.string(),
  // The name its OAuth client registered with; null when Clerk had none.
  name: z.string().nullable(),
  connectedAt: z.iso.datetime({ offset: true }),
  lastUsedAt: z.iso.datetime({ offset: true }),
});

export const assistantListSchema = z.object({ assistants: z.array(assistantSchema) });

export type Assistant = z.infer<typeof assistantSchema>;

export type AssistantList = z.infer<typeof assistantListSchema>;
