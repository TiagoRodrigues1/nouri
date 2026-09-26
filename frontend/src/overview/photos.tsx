import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog";
import { styles as formStyles } from "../form-styles";
import { dateLabel, getPhotoImage, type Photo } from "../lib/api";
import { styles } from "../overview-styles";
import { Empty, Tile, clock } from "./shared";

// Photos need the bearer token, so they load as blobs and show through object URLs.
function usePhotoUrl(token: string, id: string): string | null {
  const [url, setUrl] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["photo", token, id],
    queryFn: () => getPhotoImage(token, id),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!query.data) return;
    const next = URL.createObjectURL(query.data);

    setUrl(next);

    return () => URL.revokeObjectURL(next);
  }, [query.data]);

  return url;
}

export function PhotosTile({ token, photos, busy, onUpload, onDelete }: { token: string; photos: Photo[]; busy: boolean; onUpload: (file: File) => void; onDelete: (photo: Photo) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<Photo | null>(null);

  return (
    <Tile
      title="Progress photos"
      icon={<Camera size={16} />}
      wide
      aside={
        <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          <ImagePlus size={15} /> Upload photo
        </Button>
      }
    >
      <Input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Choose a progress photo"
        sx={styles.fileInput}
        onChange={(event) => {
          const file = event.target.files?.[0];

          // Clear the input so choosing the same file again still uploads it.
          event.target.value = "";

          if (file) onUpload(file);
        }}
      />
      {photos.length === 0 ? (
        <Empty>Upload a photo to track how your body changes over time. JPEG, PNG, or WebP up to 8 MB.</Empty>
      ) : (
        <ul {...stylex.props(styles.photos)} aria-label="Progress photos">
          {photos.map((photo) => (
            <li key={photo.id}>
              <PhotoThumb token={token} photo={photo} onOpen={() => setViewing(photo)} />
            </li>
          ))}
        </ul>
      )}
      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent>
          {viewing && (
            <PhotoView
              token={token}
              photo={viewing}
              busy={busy}
              onDelete={() => {
                onDelete(viewing);
                setViewing(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </Tile>
  );
}

function PhotoThumb({ token, photo, onOpen }: { token: string; photo: Photo; onOpen: () => void }) {
  const url = usePhotoUrl(token, photo.id);

  return (
    <button type="button" {...stylex.props(styles.thumb)} aria-label={`Open photo from ${dateLabel(photo.localDate)}`} onClick={onOpen}>
      {url ? <img src={url} alt="" {...stylex.props(styles.thumbImage)} /> : <Camera size={18} />}
      <span {...stylex.props(styles.thumbDate)}>{new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(new Date(photo.occurredAt))}</span>
    </button>
  );
}

function PhotoView({ token, photo, busy, onDelete }: { token: string; photo: Photo; busy: boolean; onDelete: () => void }) {
  const url = usePhotoUrl(token, photo.id);

  return (
    <>
      <DialogTitle {...stylex.props(formStyles.dialogTitle)}>Progress photo</DialogTitle>
      <DialogDescription {...stylex.props(formStyles.dialogDescription)}>
        Taken {dateLabel(photo.localDate)} at {clock.format(new Date(photo.occurredAt))}.
      </DialogDescription>
      {url ? <img src={url} alt={`Progress photo from ${dateLabel(photo.localDate)}`} {...stylex.props(styles.photo)} /> : <Empty>Loading photo…</Empty>}
      <div {...stylex.props(formStyles.dialogActions)}>
        <Button variant="outline" disabled={busy} onClick={onDelete}>
          <Trash2 size={15} /> Delete photo
        </Button>
      </div>
    </>
  );
}
