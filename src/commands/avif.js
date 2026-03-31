import { parseArgs, validateRange } from "../utils/args.js";
import { readGLTF, writeGLTF } from "../utils/io.js";
import { processTexturesAVIF } from "../processors/avif.js";
import { processTexturesAVIFSharp } from "../processors/avif-sharp.js";

/**
 * AVIF command - Compress textures using AVIF format
 * @param {string[]} args - Command arguments
 * @returns {Promise<void>}
 */
export async function avifCommand(args) {
  const options = parseArgs(args, {
    quality: 80,
    speed: 4,
    sharp: false, // Use sharp instead of native tools
    blaze: false, // Use blaze_enc instead of avifenc
    debug: false, // Keep intermediate files for debugging
    concurrency: 4, // Number of textures to process in parallel
  });

  // Show help if requested
  if (options.help) {
    const { helpCommand } = await import("./help.js");
    await helpCommand(["avif"]);
    return;
  }

  // Get positional arguments
  const [inputPath, outputPath] = options._positional;

  // Validate arguments
  if (!inputPath) {
    console.error("Error: Missing required input file");
    console.error("Usage: gltf-tex avif <input> [output] [options]");
    console.error('Run "gltf-tex help avif" for more information.');
    process.exit(1);
  }

  // Auto-generate output path if not provided
  let finalOutputPath = outputPath;
  if (!finalOutputPath) {
    const path = await import("node:path");
    const parsed = path.parse(inputPath);
    finalOutputPath = path.join(parsed.dir, `${parsed.name}-avif${parsed.ext}`);
    console.log(`Output file not specified, using: ${finalOutputPath}`);
  }

  // Validate options
  try {
    validateRange(options.quality, 0, 100, "quality");
    validateRange(options.speed, 0, 10, "speed");
    validateRange(options.concurrency, 1, 32, "concurrency");
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  console.log(`Processing ${inputPath}...`);
  console.log(
    `Quality: ${options.quality}, Speed: ${options.speed}, Concurrency: ${options.concurrency}`,
  );

  let encoderName = "avifenc";
  if (options.sharp) encoderName = "sharp (npm)";
  if (options.blaze) encoderName = "blaze_enc";
  console.log(`Using ${encoderName}`);
  if (options.debug) {
    console.log("Debug mode: Intermediate files will be preserved");
  }

  try {
    // Read the glTF file
    const doc = await readGLTF(inputPath);

    // Check for mesh compression extensions and warn
    const root = doc.getRoot();
    const extensionsUsed = root.listExtensionsUsed();
    const hasDraco = extensionsUsed.some(
      (ext) => ext.extensionName === "KHR_draco_mesh_compression",
    );
    const hasMeshopt = extensionsUsed.some(
      (ext) => ext.extensionName === "EXT_meshopt_compression",
    );

    if (hasDraco || hasMeshopt) {
      console.warn("\n⚠️  Warning: This file uses mesh compression:");
      if (hasDraco) console.warn("  - KHR_draco_mesh_compression");
      if (hasMeshopt) console.warn("  - EXT_meshopt_compression");
      console.warn(
        "  For optimal results, apply texture compression before mesh compression.\n",
      );
    }

    // Process textures with the appropriate processor
    if (options.sharp) {
      await processTexturesAVIFSharp(doc, inputPath, {
        quality: options.quality,
        speed: options.speed,
        debug: options.debug,
        concurrency: options.concurrency,
      });
    } else {
      await processTexturesAVIF(doc, inputPath, {
        quality: options.quality,
        speed: options.speed,
        debug: options.debug,
        blaze: options.blaze,
        concurrency: options.concurrency,
      });
    }

    // Write the output file
    await writeGLTF(finalOutputPath, doc);

    console.log(`✓ Successfully wrote ${finalOutputPath}`);
  } catch (error) {
    console.error(`Failed to process file: ${error.message}`);
    throw error;
  }
}
