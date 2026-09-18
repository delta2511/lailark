import { describe, expect, it } from "vitest";

import { assertUploadable, isImageFile, PhotoRejectedError, sortPhotos, type ProductPhoto } from "./photos";

function photo(path: string, isNote: boolean, order: number): ProductPhoto {
  return { path, url: `https://example.test/${path}`, isNote, order };
}

describe("sortPhotos", () => {
  it("keeps plain photos in upload order", () => {
    const a = photo("a", false, 2);
    const b = photo("b", false, 1);
    expect(sortPhotos([a, b])).toEqual([b, a]);
  });

  it("pins the note photo last, regardless of upload order", () => {
    const note = photo("note", true, 1);
    const plain = photo("plain", false, 2);
    // The note was uploaded first (order 1) but still sorts after the plain
    // photo uploaded second (order 2): brief section 17.8, "note photo last".
    expect(sortPhotos([note, plain])).toEqual([plain, note]);
  });

  it("orders several plain photos before several note photos", () => {
    const p1 = photo("p1", false, 3);
    const p2 = photo("p2", false, 1);
    const n1 = photo("n1", true, 2);
    const n2 = photo("n2", true, 0);
    expect(sortPhotos([n1, p1, n2, p2])).toEqual([p2, p1, n2, n1]);
  });

  it("does not mutate its input", () => {
    const input = [photo("a", false, 2), photo("b", false, 1)];
    const copy = [...input];
    sortPhotos(input);
    expect(input).toEqual(copy);
  });
});

describe("isImageFile / assertUploadable", () => {
  it("accepts an image under 8 MB", () => {
    const file = new File([new Uint8Array(10)], "jar.jpg", { type: "image/jpeg" });
    expect(isImageFile(file)).toBe(true);
    expect(() => assertUploadable(file)).not.toThrow();
  });

  it("refuses a non-image with a plain message", () => {
    const file = new File([new Uint8Array(10)], "note.pdf", { type: "application/pdf" });
    expect(isImageFile(file)).toBe(false);
    expect(() => assertUploadable(file)).toThrow(PhotoRejectedError);
    expect(() => assertUploadable(file)).toThrow(/image file/);
  });

  it("refuses an image over 8 MB with a plain message", () => {
    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "huge.png", { type: "image/png" });
    expect(() => assertUploadable(big)).toThrow(/8 MB/);
  });
});
