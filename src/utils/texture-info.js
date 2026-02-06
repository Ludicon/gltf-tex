import { ImageUtils } from "@gltf-transform/core";

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string (e.g., "1.5 MB")
 */
export function formatBytes(bytes) {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`;
}

// This is prescribed by WebGPU.
const BYTES_PER_ROW_ALIGNMENT = 256;

// Spark doesn't generate mips below this size:
const MIN_MIP_SIZE = 4;

/**
 * Compute texture size in video memory
 * @param {number} w - Width
 * @param {number} h - Height
 * @param {number} blockSize - Block size in bytes
 * @param {boolean} mipmaps - Whether to include mipmaps
 * @returns {number} Size in bytes
 */
function computeTextureSize(w, h, blockSize, mipmaps) {
  let outputSize = 0;

  do {
    const bw = Math.ceil(w / 4);
    const bh = Math.ceil(h / 4);
    const bytesPerRow =
      Math.ceil((bw * blockSize) / BYTES_PER_ROW_ALIGNMENT) *
      BYTES_PER_ROW_ALIGNMENT;
    const alignedSize = bh * bytesPerRow;

    outputSize += alignedSize;

    w = Math.max(1, Math.floor(w / 2));
    h = Math.max(1, Math.floor(h / 2));
  } while (mipmaps && (w >= MIN_MIP_SIZE || h >= MIN_MIP_SIZE));

  return outputSize;
}

/**
 * Estimate compressed texture size in video memory
 * @param {number} width - Texture width
 * @param {number} height - Texture height
 * @param {string[]} slots - Texture slots
 * @param {boolean} lowQuality - Whether to estimate for low quality
 * @returns {number} Estimated size in bytes
 */
export function estimateCompressedSize(width, height, slots, lowQuality) {
  // Align the dimensions to the block extents
  const w = Math.ceil(width / 4) * 4;
  const h = Math.ceil(height / 4) * 4;

  let blockSize = 16; // Assume 16 bytes (BC7/ASTC).

  if (slots.length === 1 && slots[0] === "occlusionTexture") {
    blockSize = 8;
  }
  if (lowQuality) {
    // @@ FIXME: Also exclude textures with alpha.
    if (!slots.includes("normalTexture")) {
      blockSize = 8;
    }
  }

  return computeTextureSize(w, h, blockSize, true);
}

/**
 * Get texture dimensions from image bytes
 * @param {Buffer} bytes - Image buffer
 * @param {string} mimeType - MIME type
 * @returns {[number, number]} Width and height
 */
export function getDimensionsFromImageBytes(bytes, mimeType) {
  const size = ImageUtils.getSize(bytes, mimeType);
  return size ? [size[0], size[1]] : [0, 0];
}

/**
 * Get texture information
 * @param {import('@gltf-transform/core').Texture} texture - Texture
 * @param {number} index - Texture index
 * @param {string[]} slots - Texture slots
 * @returns {object} Texture info
 */
export function getTextureInfo(texture, index, slots) {
  const image = texture.getImage();
  if (!image) return null;

  const name = texture.getName() || `tex_${index}`;
  const mimeType = texture.getMimeType();
  const size = image.length;

  const [width, height] = getDimensionsFromImageBytes(image, mimeType);
  const videoMemorySize = estimateCompressedSize(width, height, slots, false);
  const videoMemorySizeLow = estimateCompressedSize(width, height, slots, true);
  const videoMemorySizeUncompressed = width * height * 4;

  return {
    name,
    mimeType,
    width,
    height,
    size,
    videoMemorySize,
    videoMemorySizeLow,
    videoMemorySizeUncompressed,
    slots,
  };
}
