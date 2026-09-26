import { z } from "zod";
import { recordBaseSchema } from "../journal/contract.js";

export const photoTypes = ["image/jpeg", "image/png", "image/webp"] as const;

export const maxPhotoBytes = 8 * 1024 * 1024;

export const photoSchema = recordBaseSchema.extend({
  contentType: z.enum(photoTypes),
  byteSize: z.number().int().positive(),
});

export const photoUploadSchema = z.object({
  occurredAt: z.iso.datetime({ offset: true }),
  timeZone: z.string(),
  file: z.string().meta({ format: "binary", description: "A JPEG, PNG, or WebP image of at most 8 MB" }),
});

export type PhotoType = z.infer<typeof photoSchema>["contentType"];

export type Photo = z.infer<typeof photoSchema>;
