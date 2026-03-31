import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import pLimit from "p-limit";
import { TextureChannel } from "@gltf-transform/core";
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
    return ["-q", `${quality}`, "-s", `${speed}`, "-c", "aom", "-a", "tune=ssim", "-d", "10", "--cicp", "1/8/0"];
  }

  // If the texture is only used for occlusion, then store as greyscale.
  if (slots.length === 1 && slots[0] === "occlusionTexture") {
    return ["-q", `${quality}`, "-s", `${speed}`, "-c", "aom", "-a", "tune=ssim", "-d", "10", "--yuv", "400"];
  }

  // Encode ORM textures using identity color transform.
  if (slots.includes("metallicRoughnessTexture")) {
    return ["-q", `${quality}`, "-s", `${speed}`, "-c", "aom", "-a", "tune=ssim", "-d", "10", "--cicp", "1/8/0"];
  }

  // Everything else (baseColor, emissive, specularGlossiness, etc) uses yuv 4:4:4 and tune iq.
  return ["-q", `${quality}`, "-s", `${speed}`, "-c", "aom", "-a", "tune=iq", "-d", "10"];
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
    return ["-q", `${quality}`, "-s", `${speed}`, "--hint", "normal", "--tune", "ssim"];
  }

  // ORM textures use hint=orm and tune=ssim.
  if (slots.includes("metallicRoughnessTexture")) {
    return ["-q", `${quality}`, "-s", `${speed}`, "--hint", "orm", "--tune", "ssim"];
  }

  // Everything else (baseColor, emissive, etc) assume hint=albedo and tune=iq.
  return ["-q", `${quality}`, "--quality-alpha", `${quality}`, "-s", `${speed}`, "--hint", "albedo", "--tune", "iq"];
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
export async function processTextureAVIF(inPath, outPath, slots, quality, speed) {
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

    await run("magick", [`${inPath}`, "-channel", "R", "-separate", "-set", "colorspace", "RGB", "-combine", tmpPath]);

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
export async function processTextureBlaze(inPath, outPath, slots, quality, speed) {
  const args = blazeArgsForTexture(slots, quality, speed);

  await run("blaze_enc", ["--max-threads", os.availableParallelism().toString(), ...args, inPath, outPath]);
}

/**
 * Check if a texture's MIME type is processable (PNG, JPEG, or WebP).
 * Skips AVIF (already compressed) and DDS (alternative format extension).
 * @param {string} mimeType - Texture MIME type
 * @returns {boolean}
 */
function isProcessableMimeType(mimeType) {
  return mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp";
}

/**
 * Compute the relative path for a texture's intermediate/output files.
 * Uses the texture's URI to preserve directory structure (important for .gltf),
 * falls back to the texture name for embedded textures (e.g. .glb).
 * @param {import('@gltf-transform/core').Texture} tex - Texture object
 * @param {number} index - Texture index
 * @param {string} extension - File extension (e.g. ".png")
 * @returns {{ relPath: string, relDir: string, baseName: string }}
 */
function getTexturePaths(tex, index, extension) {
  const uri = tex.getURI();
  const name = tex.getName() || `tex_${index}`;

  if (uri) {
    return {
      relPath: uri,
      relDir: path.dirname(uri),
      baseName: path.basename(uri, path.extname(uri)),
    };
  }

  return {
    relPath: `${name}${extension}`,
    relDir: ".",
    baseName: name,
  };
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
 * @param {boolean} options.keep - Keep original images, return AVIF data without modifying textures (default: false)
 * @returns {Promise<Array|null>} In keep mode, returns array of { originalUri, avifUri, data }. Otherwise null.
 */
export async function processTexturesAVIF(doc, inputPath, options) {
  const { quality = 80, speed = 4, debug = false, blaze = false, concurrency = 4, keep = false } = options;
  const { EXTTextureAVIF } = await import("@gltf-transform/extensions");
  const { listTextureSlots, getTextureChannelMask } = await import("@gltf-transform/functions");

  // Create extension: required in replace mode (AVIF is the only format),
  // not required in keep mode (original images serve as fallback).
  doc.createExtension(EXTTextureAVIF).setRequired(!keep);

  const root = doc.getRoot();
  const textures = root.listTextures();

  // Use temp directory for intermediate files; local dir in debug mode
  const tmpDir = debug ? `${path.parse(inputPath).name}-debug` : await fs.mkdtemp(path.join(os.tmpdir(), "gltf-tex-"));
  await fs.mkdir(tmpDir, { recursive: true });

  // For keep mode, collect AVIF data to return
  const avifResults = [];

  // Statistics tracking
  const startTime = Date.now();
  let totalOriginalSize = 0;
  let totalCompressedSize = 0;
  let texturesProcessed = 0;
  let completedCount = 0;

  // Count processable textures (skip non-processable formats and unreferenced textures)
  const processable = textures.filter(
    (tex) => isProcessableMimeType(tex.getMimeType()) && listTextureSlots(tex).length > 0,
  );
  const skipped = textures.length - processable.length;

  if (skipped > 0) {
    console.log(`Skipping ${skipped} texture(s) (already AVIF or unsupported format)`);
  }
  console.log(`Processing ${processable.length} texture(s) with concurrency ${concurrency}...\n`);

  try {
    // Set up concurrency limiter
    const limit = pLimit(concurrency);

    // Create processing tasks for all textures
    const tasks = textures.map((tex, i) =>
      limit(async () => {
        const image = tex.getImage();
        if (!image) return null;

        const mimeType = tex.getMimeType();
        if (!isProcessableMimeType(mimeType)) return null;

        const slots = listTextureSlots(tex);

        // Skip textures not referenced by any material (orphaned duplicates
        // that gltf-transform creates from GLB texture/image index mismatches).
        if (slots.length === 0) return null;

        const extension = getFileExt(mimeType);
        const { relPath, relDir, baseName } = getTexturePaths(tex, i, extension);

        let inPath = path.join(tmpDir, relPath);
        const outPath = path.join(tmpDir, relDir, `${baseName}.avif`);

        // Ensure subdirectories exist
        await fs.mkdir(path.dirname(inPath), { recursive: true });
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        const channels = getTextureChannelMask(tex);
        const needsAlpha = (channels & TextureChannel.A) !== 0;

        await fs.writeFile(inPath, image);

        const currentCount = ++completedCount;
        const avifRelPath = path.join(relDir, `${baseName}.avif`).replace(/\\/g, "/");
        console.log(
          `[${currentCount}/${processable.length}] Encoding ${relPath} -> ${avifRelPath}` +
            ` with slots: [${slots}]${needsAlpha ? "" : " (stripping alpha)"}`,
        );

        const originalSize = image.length;

        try {
          // Convert to PNG if using Blaze or if WebP
          if (blaze && extension !== ".png") {
            const pngPath = path.join(tmpDir, relDir, `${baseName}.png`);
            await convertToPNG(inPath, pngPath, extension);
            inPath = pngPath;
          } else if (!blaze && extension === ".webp") {
            const tmpPath = path.join(tmpDir, relDir, `${baseName}-tmp.png`);
            await decodeWebpTexture(inPath, tmpPath);
            inPath = tmpPath;
          }

          // Strip alpha channel if the material doesn't use it
          if (!needsAlpha) {
            const noAlphaPath = inPath.replace(/\.[^.]+$/, "-noalpha.png");
            await run("magick", [inPath, "-alpha", "off", noAlphaPath]);
            inPath = noAlphaPath;
          }

          // Process with appropriate encoder
          if (blaze) {
            await processTextureBlaze(inPath, outPath, slots, quality, speed);
          } else {
            await processTextureAVIF(inPath, outPath, slots, quality, speed);
          }

          const avifBytes = await fs.readFile(outPath);

          if (keep) {
            // Keep mode: don't modify the texture, collect AVIF data
            avifResults.push({
              originalUri: tex.getURI(),
              avifUri: avifRelPath,
              data: avifBytes,
            });
          } else {
            // Replace mode: update the texture in place
            tex.setMimeType("image/avif");
            tex.setImage(avifBytes);
            tex.setURI(avifRelPath);
          }

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
          console.error(`  ✗ Failed to process ${baseName}: ${error.message}`);
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
    const totalRatio = totalOriginalSize > 0 ? ((1 - totalCompressedSize / totalOriginalSize) * 100).toFixed(1) : 0;

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
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Warning: Failed to clean up directory ${tmpDir}: ${error.message}`);
      }
    } else {
      console.log(`Debug mode: Intermediate files kept in ${tmpDir}/`);
    }
  }

  return keep ? avifResults : null;
}
