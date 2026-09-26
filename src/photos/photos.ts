import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { progressPhotos } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import type { RecordKind } from "../journal/records.js";
import { localDate } from "../time.js";
import { photoSchema } from "./contract.js";
import type { Photo, PhotoType } from "./contract.js";

export type PhotoInput = { occurredAt: string; timeZone: string; contentType: PhotoType; image: Buffer };

const recentLimit = 12;

const metadata = {
  id: progressPhotos.id,
  revision: progressPhotos.revision,
  occurredAt: progressPhotos.occurredAt,
  timeZone: progressPhotos.timeZone,
  localDate: progressPhotos.localDate,
  contentType: progressPhotos.contentType,
  byteSize: progressPhotos.byteSize,
};

type PhotoRow = { id: string; revision: number; occurredAt: Date; timeZone: string; localDate: string; contentType: PhotoType; byteSize: number };

function photo(row: PhotoRow): Photo {
  return { ...row, occurredAt: row.occurredAt.toISOString() };
}

// Trust the file's leading bytes rather than the name or the declared type.
export function detectPhotoType(image: Buffer): PhotoType | null {
  if (image.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";

  if (image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";

  if (image.subarray(0, 4).toString("latin1") === "RIFF" && image.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";

  return null;
}

export const photoRecords: RecordKind<PhotoInput, Photo> = {
  name: "photo",
  table: progressPhotos,
  schema: photoSchema,
  fingerprint: (input) => createHash("sha256").update(input.image).update(JSON.stringify([input.occurredAt, input.timeZone])).digest("hex"),
  // A removed photo keeps its row for the revision history but not the picture itself.
  erase: sql`image = ''::bytea`,
  create: async (tx, userId, input) => {
    const [row] = await tx.insert(progressPhotos).values({
      id: randomUUID(),
      userId,
      occurredAt: new Date(input.occurredAt),
      timeZone: input.timeZone,
      localDate: localDate(input.occurredAt, input.timeZone),
      contentType: input.contentType,
      byteSize: input.image.length,
      image: input.image,
    }).returning(metadata);

    if (!row) throw new Error("Photo insert returned no row");

    return photo(row);
  },
};

export async function getRecentPhotos(db: AppDatabase, userId: string, date: string): Promise<Photo[]> {
  const rows = await db.select(metadata).from(progressPhotos).where(and(
    eq(progressPhotos.userId, userId), lte(progressPhotos.localDate, date), isNull(progressPhotos.deletedAt),
  )).orderBy(desc(progressPhotos.occurredAt), desc(progressPhotos.id)).limit(recentLimit);

  return rows.map(photo);
}

export async function getPhotoImage(db: AppDatabase, userId: string, id: string): Promise<{ contentType: PhotoType; image: Buffer } | null> {
  const [row] = await db.select({ contentType: progressPhotos.contentType, image: progressPhotos.image }).from(progressPhotos)
    .where(and(eq(progressPhotos.userId, userId), eq(progressPhotos.id, id), isNull(progressPhotos.deletedAt)));

  return row ?? null;
}
