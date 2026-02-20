import { parseArgs, validateRange } from "../utils/args.js";
import { readGLTF, writeGLTF } from "../utils/io.js";
import { processTexturesAVIF } from "../processors/avif.js";

/**
 * Blaze command - Compress textures using Blaze AVIF encoder
 * @param {string[]} args - Command arguments
 * @returns {Promise<void>}
 */
export async function blazeCommand(args) {
  const options = parseArgs(args, {
    quality: 50,               // Blaze default is 50 (different from avif's 80)
    speed: 4,
    "quality-alpha": 100,      // Default to lossless alpha
    "max-threads": undefined,  // Will use os.availableParallelism()
    "tile-rows-log2": undefined,
    "tile-cols-log2": undefined,
    "auto-tiling": true,       // Blaze default is 1 (enabled)
    tenbit: true,              // Blaze default is 1 (enabled)
    tune: undefined,           // Will be auto-selected based on texture type
    hint: undefined,           // Will be auto-selected based on texture type
    "color-primaries": 2,      // CICP value for BT.709/sRGB
    "transfer-characteristics": 2, // CICP value for BT.709
    "matrix-coeffs": 2,        // CICP value for BT.709
    debug: false,
    concurrency: 4,
  });

  // Show help if requested
  if (options.help) {
    const { helpCommand } = await import("./help.js");
    helpCommand(["blaze"]);
    return;
  }

  // Get positional arguments
  const [inputPath, outputPath] = options._positional;

  // Validate arguments
  if (!inputPath) {
    console.error("Error: Missing required input file");
    console.error("Usage: gltf-tex blaze <input> [output] [options]");
    console.error('Run "gltf-tex help blaze" for more information.');
    process.exit(1);
  }

  // Auto-generate output path if not provided
  let finalOutputPath = outputPath;
  if (!finalOutputPath) {
    const path = await import("node:path");
    const parsed = path.parse(inputPath);
    finalOutputPath = path.join(parsed.dir, `${parsed.name}-blaze${parsed.ext}`);
    console.log(`Output file not specified, using: ${finalOutputPath}`);
  }

  // Validate options
  try {
    validateRange(options.quality, 0, 100, "quality");
    validateRange(options.speed, 0, 10, "speed");
    validateRange(options.concurrency, 1, 32, "concurrency");

    if (options["quality-alpha"] !== undefined) {
      validateRange(options["quality-alpha"], 0, 100, "quality-alpha");
    }
    if (options["max-threads"] !== undefined) {
      validateRange(options["max-threads"], 1, 255, "max-threads");
    }
    if (options["tile-rows-log2"] !== undefined) {
      validateRange(options["tile-rows-log2"], 0, 6, "tile-rows-log2");
    }
    if (options["tile-cols-log2"] !== undefined) {
      validateRange(options["tile-cols-log2"], 0, 6, "tile-cols-log2");
    }
    if (options["color-primaries"] !== undefined) {
      validateRange(options["color-primaries"], 1, 22, "color-primaries");
    }
    if (options["transfer-characteristics"] !== undefined) {
      validateRange(options["transfer-characteristics"], 1, 18, "transfer-characteristics");
    }
    if (options["matrix-coeffs"] !== undefined) {
      validateRange(options["matrix-coeffs"], 0, 14, "matrix-coeffs");
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  // Validate enum options
  const validTunes = ["ssim", "iq", "ssimulacra2", "psnr"];
  if (options.tune && !validTunes.includes(options.tune)) {
    console.error(`Error: tune must be one of: ${validTunes.join(", ")}`);
    process.exit(1);
  }

  const validHints = ["albedo", "normal", "displacement", "roughness", "opacity", "metalness", "orm"];
  if (options.hint && !validHints.includes(options.hint)) {
    console.error(`Error: hint must be one of: ${validHints.join(", ")}`);
    process.exit(1);
  }

  console.log(`Processing ${inputPath}...`);
  console.log(`Quality: ${options.quality}, Speed: ${options.speed}, Concurrency: ${options.concurrency}`);

  // Display Blaze-specific settings
  const settings = [];
  if (options["quality-alpha"] !== 100) {
    settings.push(`quality-alpha: ${options["quality-alpha"]}`);
  }
  if (options.tune) {
    settings.push(`tune: ${options.tune}`);
  }
  if (options.hint) {
    settings.push(`hint: ${options.hint}`);
  }
  if (options.tenbit === false) {
    settings.push("tenbit: disabled");
  }
  if (options["auto-tiling"] === false) {
    settings.push("auto-tiling: disabled");
  }
  if (options["tile-rows-log2"] !== undefined) {
    settings.push(`tile-rows-log2: ${options["tile-rows-log2"]}`);
  }
  if (options["tile-cols-log2"] !== undefined) {
    settings.push(`tile-cols-log2: ${options["tile-cols-log2"]}`);
  }
  if (options["max-threads"] !== undefined) {
    settings.push(`max-threads: ${options["max-threads"]}`);
  }
  
  if (settings.length > 0) {
    console.log(`Blaze settings: ${settings.join(", ")}`);
  }

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

    // Process textures with Blaze encoder
    await processTexturesAVIF(doc, inputPath, {
      quality: options.quality,
      speed: options.speed,
      qualityAlpha: options["quality-alpha"],
      maxThreads: options["max-threads"],
      tileRowsLog2: options["tile-rows-log2"],
      tileColsLog2: options["tile-cols-log2"],
      autoTiling: options["auto-tiling"],
      tenbit: options.tenbit,
      tune: options.tune,
      hint: options.hint,
      colorPrimaries: options["color-primaries"],
      transferCharacteristics: options["transfer-characteristics"],
      matrixCoeffs: options["matrix-coeffs"],
      debug: options.debug,
      blaze: true,
      concurrency: options.concurrency,
    });

    // Write the output file
    await writeGLTF(finalOutputPath, doc);

    console.log(`✓ Successfully wrote ${finalOutputPath}`);
  } catch (error) {
    console.error(`Failed to process file: ${error.message}`);
    throw error;
  }
}