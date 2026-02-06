import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import pLimit from "p-limit";
import { getFileExt } from "../utils/file.js";
import { formatBytes } from "../utils/texture-info.js";

/**
 * Get AVIF encoding options based on texture usage
 * @param {string[]} slots - Texture slots (e.g., 'normalTexture', 'baseColorTexture')
 * @param {number} quality - Quality level (0-100)
 * @param {number} speed - Encoding speed (0-10)
 * @returns {object} sharp AVIF options
 */
export function avifOptionsForTexture(slots, quality, speed) {
  // Convert speed (0-10, slower-faster) to effort (0-9, faster-slower)
  // speed 0 = effort 9 (slowest), speed 10 = effort 0 (fastest)
  const effort = Math.max(0, Math.min(9, Math.round(9 - speed * 0.9)));

  const baseOptions = {
    quality,
    effort,
    chromaSubsampling: "4:4:4", // Default to 4:4:4 for quality
  };

  // Encode normals - use lossless for critical data
  if (slots.length === 1 && slots[0] === "normalTexture") {
    return {
      ...baseOptions,
      lossless: quality >= 90, // Use lossless for high quality normal maps
      chromaSubsampling: "4:4:4",
    };
  }

  // IC: sharp does not support "4:0:0" chroma subsampling option.
  // If the texture is only used for occlusion, then store as greyscale.
  // if (slots.length === 1 && slots[0] === "occlusionTexture") {
  //   return {
  //     ...baseOptions,
  //     chromaSubsampling: "4:0:0", // Grayscale
  //   };
  // }

  // Encode ORM textures - maintain color fidelity
  if (slots.includes("metallicRoughnessTexture")) {
    return {
      ...baseOptions,
      chromaSubsampling: "4:4:4",
    };
  }

  // Everything else (baseColor, emissive, etc)
  return baseOptions;
}

/**
 * Normalize a normal map
 * @param {Buffer} imageBuffer - Input image buffer
 * @returns {Promise<Buffer>} Normalized image buffer
 */
async function normalizeNormalMap(imageBuffer) {
  // Read the image and ensure RGBA
  const image = sharp(imageBuffer).ensureAlpha();
  const { width, height, channels } = await image.metadata();

  // Get raw pixel data as RGBA
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Process each pixel
  const normalized = Buffer.alloc(width * height * 4);

  for (let i = 0; i < data.length; i += info.channels) {
    const outIdx = (i / info.channels) * 4;

    // Convert from [0, 255] to [-1, 1]
    let nx = (data[i] / 255) * 2 - 1;
    let ny = (data[i + 1] / 255) * 2 - 1;
    let nz = (data[i + 2] / 255) * 2 - 1;

    // Normalize the vector
    const len = Math.sqrt(Math.max(0, nx * nx + ny * ny + nz * nz));
    const invLen = len > 1e-6 ? 1 / len : 0;

    nx *= invLen;
    ny *= invLen;
    nz *= invLen;

    // Convert back to [0, 255] and clear Z component
    normalized[outIdx] = Math.round((nx * 0.5 + 0.5) * 255);
    normalized[outIdx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    normalized[outIdx + 2] = 0; // Clear Z component
    normalized[outIdx + 3] = info.channels >= 4 ? data[i + 3] : 255; // Preserve alpha or set to opaque
  }

  // Create a new image from the normalized data
  return sharp(normalized, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

/**
 * Convert image to grayscale using red channel
 * @param {Buffer} imageBuffer - Input image buffer
 * @returns {Promise<Buffer>} Grayscale image buffer
 */
async function convertToGrayscale(imageBuffer) {
  return sharp(imageBuffer)
    .extractChannel("red")
    .toColourspace("b-w")
    .toBuffer();
}

/**
 * Process a texture and encode it as AVIF using sharp
 * @param {Buffer} imageBuffer - Input image buffer
 * @param {string[]} slots - Texture slots
 * @param {number} quality - Quality level (0-100)
 * @param {number} speed - Encoding speed (0-10)
 * @returns {Promise<Buffer>} AVIF encoded buffer
 */
export async function processTextureAVIFSharp(
  imageBuffer,
  slots,
  quality,
  speed,
) {
  const options = avifOptionsForTexture(slots, quality, speed);

  let processedBuffer = imageBuffer;

  // Special processing for normal maps
  if (slots.length === 1 && slots[0] === "normalTexture") {
    processedBuffer = await normalizeNormalMap(imageBuffer);
  }
  // Special processing for occlusion maps (disabled for now to match original)
  else if (false && slots.length === 1 && slots[0] === "occlusionTexture") {
    processedBuffer = await convertToGrayscale(imageBuffer);
  }

  // Encode as AVIF
  return sharp(processedBuffer).avif(options).toBuffer();
}

/**
 * Process all textures in a glTF document with AVIF encoding using sharp
 * @param {import('@gltf-transform/core').Document} doc - glTF document
 * @param {string} inputPath - Original input path (for logging)
 * @param {object} options - Processing options
 * @param {number} options.quality - Quality level (0-100)
 * @param {number} options.speed - Encoding speed (0-10)
 * @param {boolean} options.debug - Keep intermediate files for debugging (default: false)
 * @param {number} options.concurrency - Number of textures to process in parallel (default: 4)
 * @returns {Promise<void>}
 */
export async function processTexturesAVIFSharp(doc, inputPath, options) {
  const { quality = 80, speed = 4, debug = false, concurrency = 4 } = options;
  const { EXTTextureAVIF } = await import("@gltf-transform/extensions");
  const { listTextureSlots } = await import("@gltf-transform/functions");

  // Create extension and set it as required
  const avifExt = doc.createExtension(EXTTextureAVIF).setRequired(true);

  const root = doc.getRoot();
  const textures = root.listTextures();

  // Create debug directory if needed
  let outDir = null;
  if (debug) {
    outDir = path.parse(inputPath).name;
    await fs.mkdir(outDir, { recursive: true });
  }

  // Statistics tracking
  const startTime = Date.now();
  let totalOriginalSize = 0;
  let totalCompressedSize = 0;
  let texturesProcessed = 0;
  const totalTextures = textures.length;
  let completedCount = 0;

  console.log(
    `Processing ${totalTextures} texture(s) with concurrency ${concurrency}...\n`,
  );

  try {
    // Set up concurrency limiter
    const limit = pLimit(concurrency);

    // Create processing tasks for all textures
    const tasks = textures.map((tex, i) =>
      limit(async () => {
        const image = tex.getImage();
        if (!image) return null;

        const name = tex.getName() || `tex_${i}`;
        const mimeType = tex.getMimeType();
        const slots = listTextureSlots(tex);

        const currentCount = ++completedCount;
        console.log(
          `[${currentCount}/${totalTextures}] Encoding texture ${name} (${mimeType}) with slots:`,
          slots,
        );

        try {
          // Save original image in debug mode
          if (debug && outDir) {
            const extension = getFileExt(mimeType);
            const originalPath = path.join(outDir, `${name}${extension}`);
            await fs.writeFile(originalPath, image);
          }

          // Process and encode the texture
          const avifBuffer = await processTextureAVIFSharp(
            image,
            slots,
            quality,
            speed,
          );

          // Save AVIF in debug mode
          if (debug && outDir) {
            const avifPath = path.join(outDir, `${name}.avif`);
            await fs.writeFile(avifPath, avifBuffer);
          }

          // Update texture
          tex.setImage(avifBuffer);
          tex.setMimeType("image/avif");

          const ratio = ((1 - avifBuffer.length / image.length) * 100).toFixed(
            1,
          );
          console.log(
            `  Compressed: ${formatBytes(image.length)} → ${formatBytes(avifBuffer.length)} (${ratio}% reduction)`,
          );

          return {
            success: true,
            originalSize: image.length,
            compressedSize: avifBuffer.length,
          };
        } catch (error) {
          console.error(`  ✗ Failed to process ${name}: ${error.message}`);
          return {
            success: false,
            error: error.message,
          };
        }
      }),
    );

    // Process all textures in parallel with concurrency limit
    const results = await Promise.allSettled(tasks);

    // Aggregate statistics
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        if (result.value.success) {
          totalOriginalSize += result.value.originalSize;
          totalCompressedSize += result.value.compressedSize;
          texturesProcessed++;
        }
      }
    }

    // Calculate and display summary
    const endTime = Date.now();
    const elapsedMs = endTime - startTime;
    const elapsedSeconds = (elapsedMs / 1000).toFixed(2);
    const totalRatio =
      totalOriginalSize > 0
        ? ((1 - totalCompressedSize / totalOriginalSize) * 100).toFixed(1)
        : 0;

    console.log("\n========================================");
    console.log("Texture Encoding Summary");
    console.log("========================================");
    console.log(`Textures processed: ${texturesProcessed}`);
    console.log(`Total original size: ${formatBytes(totalOriginalSize)}`);
    console.log(`Total compressed size: ${formatBytes(totalCompressedSize)}`);
    console.log(`Total compression ratio: ${totalRatio}%`);
    console.log(`Elapsed time: ${elapsedSeconds}s`);
    console.log("========================================\n");

    if (debug && outDir) {
      console.log(`Debug mode: Intermediate files kept in ${outDir}/`);
    }
  } catch (error) {
    // Clean up on error if debug is not enabled
    if (!debug && outDir) {
      try {
        await fs.rm(outDir, { recursive: true, force: true });
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
}
