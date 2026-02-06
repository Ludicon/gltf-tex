/**
 * Get file extension for mime type
 * @param {string} mimeType - MIME type
 * @returns {string} File extension with leading dot
 */
export function getFileExt(mimeType) {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/avif") return ".avif";
  return ".bin";
}

/**
 * Ensure a directory exists for the given file path
 * @param {string} filePath - File path
 * @returns {Promise<void>}
 */
export async function ensureDir(filePath) {
  const { mkdir } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
}
