import { parseArgs } from "../utils/args.js";
import { readGLTF } from "../utils/io.js";
import { getTextureInfo, formatBytes } from "../utils/texture-info.js";

/**
 * Inspect command - Inspect texture information in a glTF model
 * @param {string[]} args - Command arguments
 * @returns {Promise<void>}
 */
export async function inspectCommand(args) {
  const options = parseArgs(args);

  // Show help if requested
  if (options.help) {
    const { helpCommand } = await import("./help.js");
    helpCommand(["inspect"]);
    return;
  }

  // Get positional arguments
  const [inputPath] = options._positional;

  // Validate arguments
  if (!inputPath) {
    console.error("Error: Missing required argument");
    console.error("Usage: gltf-tex inspect <input> [options]");
    console.error('Run "gltf-tex help inspect" for more information.');
    process.exit(1);
  }

  console.log(`Inspecting ${inputPath}...`);
  console.log();

  try {
    // Read the glTF file
    const doc = await readGLTF(inputPath);
    const { listTextureSlots } = await import("@gltf-transform/functions");

    const root = doc.getRoot();
    const textures = root.listTextures();

    if (textures.length === 0) {
      console.log("No textures found in this model.");
      return;
    }

    let totalSize = 0;
    let totalVmemSize = 0;
    let totalVmemSizeLow = 0;
    let totalVmemSizeUncompressed = 0;

    // Display header
    console.log(
      "┌─────────────────────────────────────────────────────────────────────────────┐",
    );
    console.log(
      "│                              TEXTURE INFORMATION                            │",
    );
    console.log(
      "└─────────────────────────────────────────────────────────────────────────────┘",
    );
    console.log();

    for (let i = 0; i < textures.length; i++) {
      const tex = textures[i];
      const slots = listTextureSlots(tex);
      const info = getTextureInfo(tex, i, slots);

      if (!info) continue;

      totalSize += info.size;
      totalVmemSize += info.videoMemorySize;
      totalVmemSizeLow += info.videoMemorySizeLow;
      totalVmemSizeUncompressed += info.videoMemorySizeUncompressed;

      // Display texture info
      console.log(`Texture: ${info.name}`);
      console.log(`  Format:      ${info.mimeType}`);
      console.log(`  Dimensions:  ${info.width} × ${info.height}`);
      console.log(`  Disk size:   ${formatBytes(info.size)}`);
      console.log(`  Usage:       ${info.slots.join(", ") || "unused"}`);
      console.log(`  Video memory estimates:`);
      console.log(
        `    High quality:    ${formatBytes(info.videoMemorySize)} (with mipmaps)`,
      );
      console.log(
        `    Low quality:     ${formatBytes(info.videoMemorySizeLow)} (with mipmaps)`,
      );
      console.log(
        `    Uncompressed:    ${formatBytes(info.videoMemorySizeUncompressed)} (no mipmaps)`,
      );
      console.log();
    }

    // Display summary
    console.log(
      "┌─────────────────────────────────────────────────────────────────────────────┐",
    );
    console.log(
      "│                                   SUMMARY                                   │",
    );
    console.log(
      "└─────────────────────────────────────────────────────────────────────────────┘",
    );
    console.log();
    console.log(`Total textures:  ${textures.length}`);
    console.log(`Total disk size: ${formatBytes(totalSize)}`);
    console.log();
    console.log("Estimated video memory usage:");
    console.log(`  High quality:    ${formatBytes(totalVmemSize)}`);
    console.log(`  Low quality:     ${formatBytes(totalVmemSizeLow)}`);
    console.log(`  Uncompressed:    ${formatBytes(totalVmemSizeUncompressed)}`);
    console.log();
  } catch (error) {
    console.error(`Failed to inspect file: ${error.message}`);
    throw error;
  }
}
