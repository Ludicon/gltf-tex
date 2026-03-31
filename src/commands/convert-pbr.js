import path from "node:path";
import { parseArgs } from "../utils/args.js";
import { readGLTF, writeGLTF, writeGLTFProcessed } from "../utils/io.js";
import { convertSpecGlossToMetalRough } from "../processors/convert-pbr.js";

/**
 * convert-pbr command - Convert KHR_materials_pbrSpecularGlossiness to metallicRoughness + KHR_materials_specular
 * @param {string[]} args - Command arguments
 * @returns {Promise<void>}
 */
export async function convertPbrCommand(args) {
  const options = parseArgs(args, {
    exact: false, // Bake glossinessFactor into MR textures for exact results
  });

  // Show help if requested
  if (options.help) {
    const { helpCommand } = await import("./help.js");
    await helpCommand(["convert-pbr"]);
    return;
  }

  // Get positional arguments
  const [inputPath, outputPath] = options._positional;

  // Validate arguments
  if (!inputPath) {
    console.error("Error: Missing required input file");
    console.error("Usage: gltf-tex convert-pbr <input> [output]");
    console.error('Run "gltf-tex help convert-pbr" for more information.');
    process.exit(1);
  }

  // Auto-generate output path if not provided
  let finalOutputPath = outputPath;
  if (!finalOutputPath) {
    const parsed = path.parse(inputPath);
    finalOutputPath = path.join(parsed.dir, `${parsed.name}-pbr${parsed.ext}`);
    console.log(`Output file not specified, using: ${finalOutputPath}`);
  }

  console.log(`Processing ${inputPath}...`);

  try {
    const doc = await readGLTF(inputPath);

    const { converted, texturesGenerated } =
      await convertSpecGlossToMetalRough(doc, { exact: options.exact });

    if (converted === 0) {
      console.log("No KHR_materials_pbrSpecularGlossiness materials found.");
      return;
    }

    console.log(
      `\nConverted ${converted} material(s), generated ${texturesGenerated} texture(s).`,
    );

    // Write output
    const isGltf = finalOutputPath.endsWith(".gltf");
    if (isGltf) {
      await writeGLTFProcessed(finalOutputPath, doc);
    } else {
      await writeGLTF(finalOutputPath, doc);
    }

    console.log(`✓ Successfully wrote ${finalOutputPath}`);
  } catch (error) {
    console.error(`Failed to process file: ${error.message}`);
    throw error;
  }
}
