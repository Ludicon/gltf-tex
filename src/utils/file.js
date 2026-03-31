/**
 * Check if a MIME type represents a DDS image.
 * gltf-transform infers "image/dds" from .dds URIs; the registered MIME type is "image/vnd-ms.dds".
 * @param {string} mimeType
 * @returns {boolean}
 */
export function isDDSMimeType(mimeType) {
  return mimeType === "image/dds" || mimeType === "image/vnd-ms.dds";
}

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
  if (isDDSMimeType(mimeType)) return ".dds";
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
