/**
 * Photos for one product, brief section 17.8: "Photos (note photo last)."
 *
 * Read only for anyone who is not the Owner (D22's pattern, carried over
 * from ingredients and recipes): no file input renders at all for the
 * Kitchen or the Viewer, only the images and, on the note photo, its tag.
 *
 * A failed upload or a failed removal appends one plain line rather than
 * throwing the screen into a blank state (Q8: this always runs against the
 * Storage emulator, but a weak signal or a mis-picked file is a real case
 * either way).
 */
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

import { PRODUCTS } from "../copy";
import { listProductPhotos, removeProductPhoto, uploadProductPhoto, type ProductPhoto } from "./photos";

interface Props {
  readonly slug: string;
  readonly canEdit: boolean;
}

function failureLine(file: File | string, error: unknown): string {
  const name = typeof file === "string" ? file : file.name;
  const message = error instanceof Error ? error.message : PRODUCTS.photoUploadFailed;
  return `${name}: ${message}`;
}

export function ProductPhotos({ slug, canEdit }: Props): JSX.Element {
  const [photos, setPhotos] = useState<ProductPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [failures, setFailures] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listProductPhotos(slug)
      .then((items) => {
        if (alive) setPhotos(items);
      })
      .catch(() => {
        if (alive) setFailures((current) => [...current, PRODUCTS.photosLoadFailed]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  async function refresh(): Promise<void> {
    try {
      setPhotos(await listProductPhotos(slug));
    } catch {
      setFailures((current) => [...current, PRODUCTS.photosLoadFailed]);
    }
  }

  async function handleUpload(event: Event, isNote: boolean): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = "";
    if (files.length === 0) return;

    setBusy(true);
    for (const file of files) {
      try {
        await uploadProductPhoto(slug, file, isNote);
      } catch (error) {
        setFailures((current) => [...current, failureLine(file, error)]);
      }
    }
    await refresh();
    setBusy(false);
  }

  async function handleRemove(path: string): Promise<void> {
    setBusy(true);
    try {
      await removeProductPhoto(path);
      setPhotos((current) => current.filter((photo) => photo.path !== path));
    } catch (error) {
      setFailures((current) => [...current, failureLine(path, error)]);
    }
    setBusy(false);
  }

  return (
    <div class="photo-section">
      <p class="field-label">{PRODUCTS.photos}</p>

      {loading ? <p data-testid="photos-loading">{PRODUCTS.photosLoading}</p> : null}
      {!loading && photos.length === 0 ? (
        <p data-testid="photos-empty">{PRODUCTS.photosEmpty}</p>
      ) : null}

      <ul class="photo-grid" data-testid="photo-list">
        {photos.map((photo) => (
          <li key={photo.path} class="photo-item" data-testid={`photo-${photo.path}`}>
            <img src={photo.url} alt="" class="photo-thumb" />
            {photo.isNote ? <span class="photo-note-tag">{PRODUCTS.notePhoto}</span> : null}
            {canEdit ? (
              <button
                type="button"
                class="quiet"
                data-testid={`remove-photo-${photo.path}`}
                disabled={busy}
                onClick={() => void handleRemove(photo.path)}
              >
                {PRODUCTS.removePhoto}
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {failures.map((line, index) => (
        <p class="error" key={`${index}-${line}`} data-testid="photo-error">
          {line}
        </p>
      ))}

      {canEdit ? (
        <div class="photo-upload-row">
          <label for="photo-upload">{PRODUCTS.addPhoto}</label>
          <input
            id="photo-upload"
            data-testid="photo-upload"
            type="file"
            accept="image/*"
            multiple
            disabled={busy}
            onChange={(event) => void handleUpload(event, false)}
          />
          <label for="note-photo-upload">{PRODUCTS.addNotePhoto}</label>
          <input
            id="note-photo-upload"
            data-testid="note-photo-upload"
            type="file"
            accept="image/*"
            disabled={busy}
            onChange={(event) => void handleUpload(event, true)}
          />
        </div>
      ) : null}
    </div>
  );
}
