import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pLimit from "p-limit";
import { run } from "../utils/process.js";
import { getFileExt } from "../utils/file.js";
import { formatBytes } from "../utils/texture-info.js";

/**
 * Get AVIF encoding arguments based on texture usage
 * @param {string[]} slots - Texture slots (e.g., 'normalTexture', 'baseColorTexture')
 * @param {number} quality - Quality level (0-100)
 * @param {number} speed - Encoding speed (0-10)
 * @returns {string[]} avifenc arguments
 */
export function avifArgsForTexture(slots, quality, speed) {
  // Encode normals using identity color transform.
  if (slots.length === 1 && slots[0] === "normalTexture") {
    return [
      "-q",
      `${quality}`,
      "-s",
      `${speed}`,
      "-c",
      "aom",
      "-a",
      "tune=ssim",
      "-d",
      "10",
      "--cicp",
      "1/8/0",
    ];
  }

  // If the texture is only used for occlusion, then store as greyscale.
  if (slots.length === 1 && slots[0] === "occlusionTexture") {
    return [
      "-q",
      `${quality}`,
      "-s",
      `${speed}`,
      "-c",
      "aom",
      "-a",
      "tune=ssim",
      "-d",
      "10",
      "--yuv",
      "400",
    ];
  }

  // Encode ORM textures using identity color transform.
  if (slots.includes("metallicRoughnessTexture")) {
    return [
      "-q",
      `${quality}`,
      "-s",
      `${speed}`,
      "-c",
      "aom",
      "-a",
      "tune=ssim",
      "-d",
      "10",
      "--cicp",
      "1/8/0",
    ];
  }

  // Everything else (baseColor, emissive, etc) uses yuv 4:4:4 and tune iq.
  return [
    "-q",
    `${quality}`,
    "-s",
    `${speed}`,
    "-c",
    "aom",
    "-a",
    "tune=iq",
    "-d",
    "10",
  ];
}

/**
 * Get Blaze encoding arguments based on texture usage
 * @param {string[]} slots - Texture slots (e.g., 'normalTexture', 'baseColorTexture')
 * @param {number} quality - Quality level (0-100)
 * @param {number} speed - Encoding speed (0-10)
 * @returns {string[]} blaze_enc arguments
 */
export function blazeArgsForTexture(slots, quality, speed) {
  // Encode normals using hint=normal and tune=ssim.
  if (slots.length === 1 && slots[0] === "normalTexture") {
    return [
      "-q",
      `${quality}`,
      "-s",
      `${speed}`,
      "--hint",
      "normal",
      "--tune",
      "ssim",
    ];
  }

  // ORM textures use hint=orm and tune=ssim.
  if (slots.includes("metallicRoughnessTexture")) {
    return [
      "-q",
      `${quality}`,
      "-s",
      `${speed}`,
      "--hint",
      "orm",
      "--tune",
      "ssim",
    ];
  }

  // Everything else (baseColor, emissive, etc) assume hint=albedo and tune=iq.
  return [
    "-q",
    `${quality}`,
    "--quality-alpha",
    `${quality}`,
    "-s",
    `${speed}`,
    "--hint",
    "albedo",
    "--tune",
    "iq",
  ];
}

/**
 * Decode WebP texture to PNG
 * @param {string} inPath - Input WebP file path
 * @param {string} outPath - Output PNG file path
 * @returns {Promise<void>}
 */
export async function decodeWebpTexture(inPath, outPath) {
  await run("dwebp", [inPath, "-o", outPath]);
}

/**
 * Convert image to PNG format
 * @param {string} inPath - Input image file path
 * @param {string} outPath - Output PNG file path
 * @param {string} extension - Input file extension
 * @returns {Promise<void>}
 */
async function convertToPNG(inPath, outPath, extension) {
  if (extension === ".webp") {
    await run("dwebp", [inPath, "-o", outPath]);
  } else if (extension === ".jpg" || extension === ".jpeg") {
    await run("magick", [inPath, outPath]);
  } else {
    await run("magick", [inPath, outPath]);
  }
}

/**
 * Process a texture and encode it as AVIF
 * @param {string} inPath - Input image file path
 * @param {string} outPath - Output AVIF file path
 * @param {string[]} slots - Texture slots
 * @param {number} quality - Quality level (0-100)
 * @param {number} speed - Encoding speed (0-10)
 * @returns {Promise<void>}
 */
export async function processTextureAVIF(
  inPath,
  outPath,
  slots,
  quality,
  speed,
) {
  const args = avifArgsForTexture(slots, quality, speed);

  if (slots.length === 1 && slots[0] === "normalTexture") {
    // Normalize normals and clear Z component.
    const tmpPath = inPath.replace(/\.[^.]+$/, "-tmp.png");

    // prettier-ignore
    await run("magick", [
      `${inPath}`,
      "-channel", "R", "-fx", 'nx=(r-0.5)*2; ny=(g-0.5)*2; nz=(b-0.5)*2; len=sqrt(max(0, nx*nx+ny*ny+nz*nz)); len=max(len,1e-6); nx/len/2+0.5',
      "-channel", "G", "-fx", 'nx=(r-0.5)*2; ny=(g-0.5)*2; nz=(b-0.5)*2; len=sqrt(max(0, nx*nx+ny*ny+nz*nz)); len=max(len,1e-6); ny/len/2+0.5',
      "-channel", "B", "-evaluate", "set", "0", "+channel",
      tmpPath,
    ]);

    await run("avifenc", [...args, tmpPath, outPath]);

    // Clean up temporary file.
    await run("rm", [tmpPath]);
  } else if (false && slots.length === 1 && slots[0] === "occlusionTexture") {
    // Note: This is disabled for now as it shifts occlusion values
    // Replicate R channel across RGB:
    const tmpPath = inPath.replace(/\.[^.]+$/, "-tmp.png");

    await run("magick", [
      `${inPath}`,
      "-channel",
      "R",
      "-separate",
      "-set",
      "colorspace",
      "RGB",
      "-combine",
      tmpPath,
    ]);

    await run("avifenc", [...args, tmpPath, outPath]);

    // Clean up temporary file.
    await run("rm", [tmpPath]);
  } else {
    await run("avifenc", [...args, inPath, outPath]);
  }
}

/**
 * Process a texture and encode it as Blaze/AVIF
 * @param {string} inPath - Input image file path
 * @param {string} outPath - Output AVIF file path
 * @param {string[]} slots - Texture slots
 * @param {number} quality - Quality level (0-100)
 * @param {number} speed - Encoding speed (0-10)
 * @returns {Promise<void>}
 */
export async function processTextureBlaze(
  inPath,
  outPath,
  slots,
  quality,
  speed,
) {
  const args = blazeArgsForTexture(slots, quality, speed);

  await run("blaze_enc", [
    "--max-threads",
    os.availableParallelism().toString(),
    ...args,
    inPath,
    outPath,
  ]);
}

/**
 * Process all textures in a glTF document with AVIF encoding
 * @param {import('@gltf-transform/core').Document} doc - glTF document
 * @param {string} inputPath - Original input path (for creating output directory)
 * @param {object} options - Processing options
 * @param {number} options.quality - Quality level (0-100)
 * @param {number} options.speed - Encoding speed (0-10)
 * @param {boolean} options.debug - Keep intermediate files for debugging (default: false)
 * @param {boolean} options.blaze - Use blaze_enc instead of avifenc (default: false)
 * @param {number} options.concurrency - Number of textures to process in parallel (default: 4)
 * @returns {Promise<void>}
 */
export async function processTexturesAVIF(doc, inputPath, options) {
  const {
    quality = 80,
    speed = 4,
    debug = false,
    blaze = false,
    concurrency = 4,
  } = options;
  const { EXTTextureAVIF } = await import("@gltf-transform/extensions");
  const { listTextureSlots } = await import("@gltf-transform/functions");

  // Create extension and set it as required
  const avifExt = doc.createExtension(EXTTextureAVIF).setRequired(true);

  const root = doc.getRoot();
  const textures = root.listTextures();

  const outDir = path.parse(inputPath).name;

  // Ensure output directory exists
  await fs.mkdir(outDir, { recursive: true });

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
        const extension = getFileExt(tex.getMimeType());
        let inPath = path.join(outDir, `${name}${extension}`);
        const outPath = path.join(outDir, `${name}.avif`);

        const slots = listTextureSlots(tex);

        await fs.writeFile(inPath, image);

        const currentCount = ++completedCount;
        console.log(
          `[${currentCount}/${totalTextures}] Encoding ${inPath} -> ${outPath} with slots:`,
          slots,
        );

        const originalSize = image.length;

        try {
          // Convert to PNG if using Blaze or if WebP
          if (blaze && extension !== ".png") {
            const pngPath = path.join(outDir, `${name}.png`);
            await convertToPNG(inPath, pngPath, extension);
            inPath = pngPath;
          } else if (!blaze && extension === ".webp") {
            const tmpPath = path.join(outDir, `${name}-tmp.png`);
            await decodeWebpTexture(inPath, tmpPath);
            inPath = tmpPath;
          }

          // Process with appropriate encoder
          if (blaze) {
            await processTextureBlaze(inPath, outPath, slots, quality, speed);
          } else {
            await processTextureAVIF(inPath, outPath, slots, quality, speed);
          }

          tex.setMimeType("image/avif");

          const avifBytes = await fs.readFile(outPath);
          tex.setImage(avifBytes);

          // Display compression stats
          const compressedSize = avifBytes.length;
          const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
          console.log(
            `  Compressed: ${formatBytes(originalSize)} → ${formatBytes(compressedSize)} (${ratio}% reduction)`,
          );

          return {
            success: true,
            originalSize,
            compressedSize,
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
  } finally {
    // Cleanup intermediate files unless debug mode is enabled
    if (!debug) {
      try {
        await fs.rm(outDir, { recursive: true, force: true });
      } catch (error) {
        console.warn(
          `Warning: Failed to clean up directory ${outDir}: ${error.message}`,
        );
      }
    } else {
      console.log(`Debug mode: Intermediate files kept in ${outDir}/`);
    }
  }
}
