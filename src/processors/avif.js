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
 * @param {object} options - Additional Blaze options
 * @param {number} [options.qualityAlpha] - Quality factor for alpha (0-100=lossless)
 * @param {number} [options.tileRowsLog2] - Tile rows log2 (0-6)
 * @param {number} [options.tileColsLog2] - Tile columns log2 (0-6)
 * @param {boolean} [options.autoTiling] - Enable automatic tiling
 * @param {boolean} [options.tenbit] - Force 10-bit output
 * @param {number} [options.colorPrimaries] - Color primaries (1-22)
 * @param {number} [options.transferCharacteristics] - Transfer characteristics (1-18)
 * @param {number} [options.matrixCoeffs] - Matrix coefficients (0-14)
 * @returns {string[]} blaze_enc arguments
 */
export function blazeArgsForTexture(slots, quality, speed, options = {}) {
  const {
    qualityAlpha,
    tileRowsLog2,
    tileColsLog2,
    autoTiling,
    tenbit,
    colorPrimaries,
    transferCharacteristics,
    matrixCoeffs,
  } = options;

  let hint;
  let tune;

  // Determine hint and tune based on texture type
  if (slots.length === 1 && slots[0] === "normalTexture") {
    hint = "normal";
    tune = "ssim";
  } else if (slots.includes("metallicRoughnessTexture")) {
    hint = "orm";
    tune = "ssim";
  } else {
    hint = "albedo";
    tune = "iq";
  }

  // Override tune if explicitly specified and slots aren't forcing specific tune
  if (options.tune) {
    tune = options.tune;
  }

  // Override hint if explicitly specified and slots aren't forcing specific hint
  if (options.hint) {
    hint = options.hint;
  }

  const args = [
    "-q",
    `${quality}`,
    "-s",
    `${speed}`,
    "--hint",
    hint,
    "--tune",
    tune,
  ];

  // Add quality-alpha if specified (for non-normal textures, defaults to quality otherwise)
  if (qualityAlpha !== undefined) {
    args.push("--quality-alpha", `${qualityAlpha}`);
  } else if (hint === "albedo") {
    // For albedo textures, default to using same quality for alpha
    args.push("--quality-alpha", `${quality}`);
  }

  // Add tile configuration
  if (tileRowsLog2 !== undefined) {
    args.push("--tile-rows-log2", `${tileRowsLog2}`);
  }
  if (tileColsLog2 !== undefined) {
    args.push("--tile-cols-log2", `${tileColsLog2}`);
  }
  if (autoTiling !== undefined) {
    args.push("--auto-tiling", autoTiling ? "1" : "0");
  }

  // Add bit depth option
  if (tenbit !== undefined) {
    args.push("--tenbit", tenbit ? "1" : "0");
  }

  // Add color space options
  if (colorPrimaries !== undefined) {
    args.push("--color-primaries", `${colorPrimaries}`);
  }
  if (transferCharacteristics !== undefined) {
    args.push("--transfer-characteristics", `${transferCharacteristics}`);
  }
  if (matrixCoeffs !== undefined) {
    args.push("--matrix-coeffs", `${matrixCoeffs}`);
  }

  return args;
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
 * @param {object} options - Additional Blaze options
 * @param {number} [options.qualityAlpha] - Quality factor for alpha (0-100=lossless)
 * @param {number} [options.maxThreads] - Maximum number of threads to use (1-255)
 * @param {number} [options.tileRowsLog2] - Tile rows log2 (0-6)
 * @param {number} [options.tileColsLog2] - Tile columns log2 (0-6)
 * @param {boolean} [options.autoTiling] - Enable automatic tiling
 * @param {boolean} [options.tenbit] - Force 10-bit output
 * @param {string} [options.tune] - Tuning mode (ssim, iq, ssimulacra2, psnr)
 * @param {string} [options.hint] - Texture hint (albedo, normal, displacement, roughness, opacity, metalness, orm)
 * @param {number} [options.colorPrimaries] - Color primaries (1-22)
 * @param {number} [options.transferCharacteristics] - Transfer characteristics (1-18)
 * @param {number} [options.matrixCoeffs] - Matrix coefficients (0-14)
 * @returns {Promise<void>}
 */
export async function processTextureBlaze(
  inPath,
  outPath,
  slots,
  quality,
  speed,
  options = {},
) {
  const { maxThreads } = options;

  const args = blazeArgsForTexture(slots, quality, speed, options);

  // Determine thread count
  const threadCount =
    maxThreads !== undefined ? maxThreads : os.availableParallelism();

  await run("blaze_enc", [
    "--max-threads",
    threadCount.toString(),
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
 * @param {number} [options.qualityAlpha] - Quality factor for alpha (0-100=lossless) [Blaze only]
 * @param {number} [options.maxThreads] - Maximum number of threads to use (1-255) [Blaze only]
 * @param {number} [options.tileRowsLog2] - Tile rows log2 (0-6) [Blaze only]
 * @param {number} [options.tileColsLog2] - Tile columns log2 (0-6) [Blaze only]
 * @param {boolean} [options.autoTiling] - Enable automatic tiling [Blaze only]
 * @param {boolean} [options.tenbit] - Force 10-bit output [Blaze only]
 * @param {string} [options.tune] - Tuning mode (ssim, iq, ssimulacra2, psnr) [Blaze only]
 * @param {string} [options.hint] - Texture hint override [Blaze only]
 * @param {number} [options.colorPrimaries] - Color primaries (1-22) [Blaze only]
 * @param {number} [options.transferCharacteristics] - Transfer characteristics (1-18) [Blaze only]
 * @param {number} [options.matrixCoeffs] - Matrix coefficients (0-14) [Blaze only]
 * @returns {Promise<void>}
 */
export async function processTexturesAVIF(doc, inputPath, options) {
  const {
    quality = 80,
    speed = 4,
    debug = false,
    blaze = false,
    concurrency = 4,
    qualityAlpha,
    maxThreads,
    tileRowsLog2,
    tileColsLog2,
    autoTiling,
    tenbit,
    tune,
    hint,
    colorPrimaries,
    transferCharacteristics,
    matrixCoeffs,
  } = options;
  const { EXTTextureAVIF } = await import("@gltf-transform/extensions");
  const { listTextureSlots } = await import("@gltf-transform/functions");

  // Create extension and set it as required
  doc.createExtension(EXTTextureAVIF).setRequired(true);

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
            await processTextureBlaze(inPath, outPath, slots, quality, speed, {
              qualityAlpha,
              maxThreads,
              tileRowsLog2,
              tileColsLog2,
              autoTiling,
              tenbit,
              tune,
              hint,
              colorPrimaries,
              transferCharacteristics,
              matrixCoeffs,
            });
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
