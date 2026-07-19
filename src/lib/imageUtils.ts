// lib/imageUtils.ts — Client-side image optimisation before AI scanning.
//
// Phone camera photos are typically 3000–4000px, 3–8 MB. AI vision models
// (Gemini, Groq/Llama Vision) don't need that resolution for reading text —
// anything beyond ~1600px on the long edge adds transfer/processing cost
// with zero accuracy benefit for OCR-style extraction.
//
// This resizes + re-compresses every image before it ever leaves the
// browser, which cuts:
//   - IPC payload size to Rust (by 80–95% typically)
//   - Peak JS memory (the wasteful Array<number> conversion downstream
//     operates on far fewer bytes)
//   - Gemini/Groq upload + processing time
//   - Disk temp file size in Rust
//   - Failure rate on poor rural connections (smaller upload = less likely
//     to time out)

const MAX_DIMENSION = 1600;      // long edge, px — plenty for text OCR
const JPEG_QUALITY   = 0.85;     // visually lossless for text/handwriting
const MAX_OUTPUT_MB  = 2;        // hard cap — re-compress harder if exceeded

/**
 * Resize and compress an image file for AI scanning.
 * Returns a new File (JPEG) sized for efficient transfer, or the original
 * file unchanged if it's already small and doesn't need processing.
 */
export async function optimiseImageForScan(file: File): Promise<File> {
  // Skip processing for already-small files — not worth the CPU cost
  if (file.size < 400 * 1024 && !(await needsDownscale(file))) {
    return file;
  }

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file; // fallback: some formats (heic etc) can't decode in-browser

  const { width, height } = bitmap;
  const longEdge = Math.max(width, height);
  const scale = longEdge > MAX_DIMENSION ? MAX_DIMENSION / longEdge : 1;

  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return file;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  bitmap.close();

  let quality = JPEG_QUALITY;
  let blob = await canvasToBlob(canvas, quality);

  // If still too large (rare — very busy/high-contrast images), step quality down
  let attempts = 0;
  while (blob.size > MAX_OUTPUT_MB * 1024 * 1024 && attempts < 3) {
    quality -= 0.15;
    blob = await canvasToBlob(canvas, Math.max(quality, 0.4));
    attempts++;
  }

  const newName = file.name.replace(/\.\w+$/, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg" });
}

/** Quick check: does this file's actual pixel size exceed our target? */
async function needsDownscale(file: File): Promise<boolean> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return false;
  const long = Math.max(bitmap.width, bitmap.height);
  bitmap.close();
  return long > MAX_DIMENSION;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
      "image/jpeg",
      quality
    );
  });
}

/**
 * Convert a File to a byte array ready for Tauri invoke().
 * Uses the smallest representation Tauri's IPC will accept — still a
 * plain number array under the hood, but since the file has already been
 * optimised, the array is 80-95% smaller than it would be from a raw photo.
 */
export async function fileToBytes(file: File): Promise<number[]> {
  const buf = await file.arrayBuffer();
  return Array.from(new Uint8Array(buf));
}

/** One-shot helper: optimise + convert in a single call. */
export async function fileToOptimisedBytes(file: File): Promise<{ bytes: number[]; filename: string; originalSize: number; optimisedSize: number }> {
  const originalSize = file.size;
  const optimised = await optimiseImageForScan(file);
  const bytes = await fileToBytes(optimised);
  return {
    bytes,
    filename: optimised.name,
    originalSize,
    optimisedSize: optimised.size,
  };
}
