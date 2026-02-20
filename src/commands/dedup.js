import { parseArgs } from "../utils/args.js";
import { readGLTF, writeGLTF } from "../utils/io.js";
import { dedupTextures } from "../processors/dedup.js";
import process from "node:process";

/**
 * Dedup command - Remove duplicate textures
 * @param {string[]} args - Command arguments
 * @returns {Promise<void>}
 */
export async function dedupCommand(args) {
  const options = parseArgs(args, {
    verbose: false, // Show detailed logging
  });

  // Show help if requested
  if (options.help) {
    const { helpCommand } = await import("./help.js");
    helpCommand(["dedup"]);
    return;
  }

  // Get positional arguments
  const [inputPath, outputPath] = options._positional;

  // Validate arguments
  if (!inputPath) {
    console.error("Error: Missing required input file");
    console.error("Usage: gltf-tex dedup <input> [output] [options]");
    console.error('Run "gltf-tex help dedup" for more information.');
    process.exit(1);
  }

  // Auto-generate output path if not provided
  let finalOutputPath = outputPath;
  if (!finalOutputPath) {
    const path = await import("node:path");
    const parsed = path.parse(inputPath);
    finalOutputPath = path.join(
      parsed.dir,
      `${parsed.name}-dedup${parsed.ext}`,
    );
    console.log(`Output file not specified, using: ${finalOutputPath}`);
  }

  console.log(`Processing ${inputPath}...`);
  if (options.verbose) {
    console.log("Verbose mode: Detailed logging enabled");
  }
  console.log("");

  try {
    // Read the glTF file
    const doc = await readGLTF(inputPath);

    // Remove duplicate textures
    const _stats = await dedupTextures(doc, {
      verbose: options.verbose,
    });

    // Write the output file
    await writeGLTF(finalOutputPath, doc);

    console.log(`\n✓ Successfully wrote ${finalOutputPath}`);
  } catch (error) {
    console.error(`Failed to process file: ${error.message}`);
    throw error;
  }
}
