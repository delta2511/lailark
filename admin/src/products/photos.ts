/**
 * Product photos, brief section 17.8: "Photos (note photo last)."
 *
 * Q8: Cloud Storage has never been started on either Firebase project, so
 * there is no real bucket to write to. This module is built and tested
 * against the Storage emulator only; the storage rules already let the
 * Owner write and every admin role read `products/{slug}/**` (`storage.
 * rules`), so nothing here needs a rules change, and nothing here deploys a
 * bucket or touches production Storage.
 *
 * Order is not a separate Firestore field: each upload carries its position
 * and whether it is the note photo as Storage custom metadata, so the
 * photos live entirely in Storage the way the brief's Firestore collection
 * list (section 18.1) says they should, listing `products/{slug}` with no
 * photos field at all.
 */
import {
  deleteObject,
  getDownloadURL,
  getMetadata,
  listAll,
  ref,
  uploadBytes,
  type FirebaseStorage,
} from "firebase/storage";

import { storage } from "../firebase";

/** Matches `storage.rules`' `isImageUnder8Mb()`. */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export class PhotoRejectedError extends Error {}

export interface ProductPhoto {
  readonly path: string;
  readonly url: string;
  readonly isNote: boolean;
  /** The upload order, used to break ties within the same group. */
  readonly order: number;
}

export function productPhotoFolder(slug: string): string {
  return `products/${slug}`;
}

/**
 * Pure: the note photo (or photos, though there is meant to be one) always
 * sorts after every plain photo, whatever order they were uploaded in.
 * Within a group, earlier uploads come first.
 */
export function sortPhotos(photos: readonly ProductPhoto[]): ProductPhoto[] {
  return [...photos].sort((a, b) => {
    if (a.isNote !== b.isNote) return a.isNote ? 1 : -1;
    return a.order - b.order;
  });
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

/** Throws a plain, screen-safe message rather than letting the SDK's error through. */
export function assertUploadable(file: File): void {
  if (!isImageFile(file)) {
    throw new PhotoRejectedError("Please choose an image file.");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new PhotoRejectedError("That photo is larger than 8 MB.");
  }
}

function metadataFor(isNote: boolean, order: number): Record<string, string> {
  return { role: isNote ? "note" : "photo", order: String(order) };
}

export async function uploadProductPhoto(
  slug: string,
  file: File,
  isNote: boolean,
  bucket: FirebaseStorage = storage,
): Promise<void> {
  assertUploadable(file);
  const order = Date.now();
  const path = `${productPhotoFolder(slug)}/${order}-${file.name}`;
  await uploadBytes(ref(bucket, path), file, {
    contentType: file.type,
    customMetadata: metadataFor(isNote, order),
  });
}

export async function listProductPhotos(
  slug: string,
  bucket: FirebaseStorage = storage,
): Promise<ProductPhoto[]> {
  const listing = await listAll(ref(bucket, productPhotoFolder(slug)));
  const photos = await Promise.all(
    listing.items.map(async (item) => {
      const [url, meta] = await Promise.all([getDownloadURL(item), getMetadata(item)]);
      const order = Number(meta.customMetadata?.order ?? "0");
      return {
        path: item.fullPath,
        url,
        isNote: meta.customMetadata?.role === "note",
        order: Number.isFinite(order) ? order : 0,
      };
    }),
  );
  return sortPhotos(photos);
}

export async function removeProductPhoto(path: string, bucket: FirebaseStorage = storage): Promise<void> {
  await deleteObject(ref(bucket, path));
}
