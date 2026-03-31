import { parseArgs } from "../utils/args.js";
import { readGLTF, readGLTFJson } from "../utils/io.js";
import { isDDSMimeType } from "../utils/file.js";
import { getTextureInfo, formatBytes } from "../utils/texture-info.js";
import { buildTextureSlotMap, listLogicalTextures } from "../utils/texture-slots.js";
import { getTextureChannelMask } from "@gltf-transform/functions";

/**
 * Size command - Display texture size information in a glTF model
 * @param {string[]} args - Command arguments
 * @returns {Promise<void>}
 */
export async function sizeCommand(args) {
  const options = parseArgs(args, {
    dds: false, // Prefer DDS source when available
  });

  // Show help if requested
  if (options.help) {
    const { helpCommand } = await import("./help.js");
    helpCommand(["size"]);
    return;
  }

  // Get positional arguments
  const [inputPath] = options._positional;

  // Validate arguments
  if (!inputPath) {
    console.error("Error: Missing required argument");
    console.error("Usage: gltf-tex size <input> [options]");
    console.error('Run "gltf-tex help size" for more information.');
    process.exit(1);
  }

  console.log(`Analyzing ${inputPath}...`);
  console.log();

  try {
    // Read the glTF document and raw JSON
    const [doc, json] = await Promise.all([readGLTF(inputPath), readGLTFJson(inputPath)]);

    const root = doc.getRoot();
    const textures = root.listTextures();

    if (textures.length === 0) {
      console.log("No textures found in this model.");
      return;
    }

    // Build slot map using raw JSON for multi-source propagation
    const slotMap = buildTextureSlotMap(textures, json);

    // Map image URIs to gltf-transform Texture objects
    const uriToTexObj = new Map();
    for (const tex of textures) {
      const uri = tex.getURI();
      if (uri) uriToTexObj.set(uri, tex);
    }

    // Get the logical texture list from the raw JSON
    const logicalTextures = listLogicalTextures(json);
    const images = json.images || [];

    // For each logical texture, pick the preferred source
    const selectedTextures = [];
    for (const logical of logicalTextures) {
      // Collect candidate image indices: standard + alternatives
      const candidates = [];
      if (logical.standardImageIndex !== undefined) {
        candidates.push(logical.standardImageIndex);
      }
      for (const idx of logical.altImageIndices) {
        candidates.push(idx);
      }

      // Find the preferred source
      let chosen = null;
      if (options.dds) {
        // Prefer DDS: pick the first DDS candidate, fall back to standard
        for (const idx of candidates) {
          const img = images[idx];
          if (img && img.uri && uriToTexObj.has(img.uri)) {
            const tex = uriToTexObj.get(img.uri);
            if (isDDSMimeType(tex.getMimeType())) {
              chosen = tex;
              break;
            }
          }
        }
      }
      // Default / fallback: prefer the standard source
      if (!chosen && logical.standardImageIndex !== undefined) {
        const img = images[logical.standardImageIndex];
        if (img && img.uri && uriToTexObj.has(img.uri)) {
          chosen = uriToTexObj.get(img.uri);
        }
      }
      // Last resort: first available candidate
      if (!chosen) {
        for (const idx of candidates) {
          const img = images[idx];
          if (img && img.uri && uriToTexObj.has(img.uri)) {
            chosen = uriToTexObj.get(img.uri);
            break;
          }
        }
      }

      if (chosen) {
        selectedTextures.push(chosen);
      }
    }

    let totalSize = 0;
    let totalVmemSize = 0;
    let totalVmemSizeLow = 0;
    let totalVmemSizeUncompressed = 0;
    let totalVmemSizeCompressed = 0;

    // Display header
    console.log("┌─────────────────────────────────────────────────────────────────────────────┐");
    console.log("│                              TEXTURE INFORMATION                            │");
    console.log("└─────────────────────────────────────────────────────────────────────────────┘");
    console.log();

    for (let i = 0; i < selectedTextures.length; i++) {
      const tex = selectedTextures[i];
      const slots = slotMap.get(tex) || [];
      const channels = getTextureChannelMask(tex);
      const info = getTextureInfo(tex, i, slots, channels);

      if (!info) continue;

      const mimeType = tex.getMimeType();
      const isGpuCompressed = mimeType === "image/ktx2" || isDDSMimeType(mimeType);

      totalSize += info.size;
      if (isGpuCompressed) {
        totalVmemSizeCompressed += info.videoMemorySize;
      } else {
        totalVmemSize += info.videoMemorySize;
        totalVmemSizeLow += info.videoMemorySizeLow;
        totalVmemSizeUncompressed += info.videoMemorySizeUncompressed;
      }

      // Display texture info
      console.log(`Texture: ${info.name}`);
      console.log(`  Format:      ${info.mimeType}`);
      console.log(`  Dimensions:  ${info.width} × ${info.height}`);
      console.log(`  Disk size:   ${formatBytes(info.size)}`);
      console.log(`  Usage:       ${info.slots.join(", ") || "unused"}`);
      console.log(`  Video memory estimates:`);
      if (isGpuCompressed) {
        console.log(`    Compressed:      ${formatBytes(info.videoMemorySize)}`);
      } else {
        console.log(`    High quality:    ${formatBytes(info.videoMemorySize)} (with mipmaps)`);
        console.log(`    Low quality:     ${formatBytes(info.videoMemorySizeLow)} (with mipmaps)`);
        console.log(`    Uncompressed:    ${formatBytes(info.videoMemorySizeUncompressed)} (no mipmaps)`);
      }
      console.log();
    }

    // Display summary
    console.log("┌─────────────────────────────────────────────────────────────────────────────┐");
    console.log("│                                   SUMMARY                                   │");
    console.log("└─────────────────────────────────────────────────────────────────────────────┘");
    console.log();
    console.log(`Total textures:  ${selectedTextures.length}`);
    console.log(`Total disk size: ${formatBytes(totalSize)}`);
    console.log();
    console.log("Estimated video memory usage:");
    console.log(`  High quality:    ${formatBytes(totalVmemSize)}`);
    console.log(`  Low quality:     ${formatBytes(totalVmemSizeLow)}`);
    console.log(`  Uncompressed:    ${formatBytes(totalVmemSizeUncompressed)}`);
    if (totalVmemSizeCompressed > 0) {
      console.log(`  Compressed:      ${formatBytes(totalVmemSizeCompressed)}`);
    }
    console.log();
  } catch (error) {
    console.error(`Failed to analyze file: ${error.message}`);
    throw error;
  }
}
