/**
 * Where a document's PDF lives, and how a link to it is handed out.
 *
 * `documents/**` in the bucket takes no client write and is readable only by
 * Owner and Viewer (`storage.rules`), so nothing here is reachable from a
 * phone. The Kitchen never reads the bucket at all: D35 gives it the bill
 * through `billForOrder`, which is this module called with admin rights.
 *
 * ## Signed URLs, and the emulator
 *
 * A production link is a V4 signed URL, made by the function's own service
 * account (which needs `iam.serviceAccounts.signBlob` on itself), and it
 * expires in {@link BILL_LINK_MINUTES}. Short on purpose: a bill is a
 * customer's name, their number and what they paid, and a link that outlives
 * the tap that made it is a link that gets forwarded.
 *
 * **The Storage emulator cannot sign anything**: there is no service account
 * behind it and no signBlob to call, so `getSignedUrl` fails there. Rather
 * than let the emulator path be untested, {@link readLinkFor} detects the
 * emulator and returns its ordinary download URL, which the emulator serves
 * without auth. The result says which kind it is (`signed`), so a test can
 * assert that production asks for a signed URL and the emulator does not, and
 * so nothing can quietly ship an unsigned link to a real customer.
 */

import { getStorage } from "firebase-admin/storage";

import { getAdminApp } from "../lib/admin";

/** How long a link to a bill is good for. */
export const BILL_LINK_MINUTES = 10;

/** `documents/26-27/LK-26-27-0001.pdf`. Foldered by financial year. */
export function documentPdfPath(documentId: string, fyLabel: string): string {
  return `documents/${fyLabel}/${documentId}.pdf`;
}

/** True when this process is talking to the Storage emulator. */
export function usingStorageEmulator(): boolean {
  return (
    typeof process.env.STORAGE_EMULATOR_HOST === "string" ||
    typeof process.env.FIREBASE_STORAGE_EMULATOR_HOST === "string"
  );
}

function emulatorHost(): string {
  const raw =
    process.env.STORAGE_EMULATOR_HOST ?? process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? "";
  return raw.startsWith("http") ? raw : `http://${raw}`;
}

function bucket() {
  return getStorage(getAdminApp()).bucket();
}

/**
 * A fixed download token, **only ever set against the emulator**.
 *
 * The emulator enforces the same `storage.rules` as production, so an
 * ordinary download URL to `documents/**` is refused for a caller with no
 * token. A download token is how `getDownloadURL` works and is the one thing
 * the emulator will honour without signing. It never reaches production: it
 * is attached only when {@link usingStorageEmulator} is true, and a download
 * token does not expire, which is exactly why production signs instead.
 */
export const EMULATOR_DOWNLOAD_TOKEN = "emulator-only-token";

/** Writes the bytes. Private, `application/pdf`, no cache anywhere public. */
export async function putDocumentPdf(path: string, bytes: Uint8Array): Promise<void> {
  await bucket()
    .file(path)
    .save(Buffer.from(bytes), {
      contentType: "application/pdf",
      metadata: {
        cacheControl: "private, max-age=0, no-store",
        ...(usingStorageEmulator()
          ? { metadata: { firebaseStorageDownloadTokens: EMULATOR_DOWNLOAD_TOKEN } }
          : {}),
      },
      resumable: false,
    });
}

export async function documentPdfExists(path: string): Promise<boolean> {
  const [exists] = await bucket().file(path).exists();
  return exists;
}

export async function deleteDocumentPdf(path: string): Promise<void> {
  await bucket().file(path).delete({ ignoreNotFound: true });
}

export interface DocumentLink {
  readonly url: string;
  readonly expiresAtMillis: number;
  /** False only against the emulator, which cannot sign. */
  readonly signed: boolean;
}

/** A short-lived link to one stored PDF. */
export async function readLinkFor(
  path: string,
  minutes: number = BILL_LINK_MINUTES,
): Promise<DocumentLink> {
  const expiresAtMillis = Date.now() + minutes * 60_000;

  if (usingStorageEmulator()) {
    const name = bucket().name;
    return {
      url: `${emulatorHost()}/v0/b/${name}/o/${encodeURIComponent(path)}?alt=media&token=${EMULATOR_DOWNLOAD_TOKEN}`,
      expiresAtMillis,
      signed: false,
    };
  }

  const [url] = await bucket().file(path).getSignedUrl({
    version: "v4",
    action: "read",
    expires: expiresAtMillis,
  });
  return { url, expiresAtMillis, signed: true };
}
