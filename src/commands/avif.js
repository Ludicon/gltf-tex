import path from "node:path";
import { parseArgs, validateRange } from "../utils/args.js";
import { isDDSMimeType } from "../utils/file.js";
import { readGLTF, writeGLTF, writeGLTFProcessed } from "../utils/io.js";
import { processTexturesAVIF } from "../processors/avif.js";
import { processTexturesAVIFSharp } from "../processors/avif-sharp.js";

/**
 * Strip an extension from the glTF JSON output.
 * Removes it from extensionsUsed/extensionsRequired and from all texture entries.
 * @param {object} json - glTF JSON object
 * @param {string} extName - Extension name to strip (e.g. "MSFT_texture_dds")
 */
function stripExtension(json, extName) {
  if (json.extensionsUsed) {
    json.extensionsUsed = json.extensionsUsed.filter((e) => e !== extName);
    if (json.extensionsUsed.length === 0) delete json.extensionsUsed;
  }
  if (json.extensionsRequired) {
    json.extensionsRequired = json.extensionsRequired.filter(
      (e) => e !== extName,
    );
    if (json.extensionsRequired.length === 0) delete json.extensionsRequired;
  }

  // Remove from texture entries
  if (json.textures) {
    for (const tex of json.textures) {
      if (tex.extensions && tex.extensions[extName]) {
        delete tex.extensions[extName];
        if (Object.keys(tex.extensions).length === 0) {
          delete tex.extensions;
        }
      }
    }
  }

  // Remove orphaned images (images only referenced by the stripped extension).
  // Build a set of all image indices still referenced by textures.
  if (json.images && json.textures) {
    const referenced = new Set();
    for (const tex of json.textures) {
      if (tex.source !== undefined) referenced.add(tex.source);
      if (tex.extensions) {
        for (const ext of Object.values(tex.extensions)) {
          if (ext && ext.source !== undefined) referenced.add(ext.source);
        }
      }
    }

    // Build index remapping (only keep referenced images)
    const remap = new Map();
    const newImages = [];
    for (let i = 0; i < json.images.length; i++) {
      if (referenced.has(i)) {
        remap.set(i, newImages.length);
        newImages.push(json.images[i]);
      }
    }

    // Only remap if we actually removed images
    if (newImages.length < json.images.length) {
      json.images = newImages;

      // Update all source references
      for (const tex of json.textures) {
        if (tex.source !== undefined && remap.has(tex.source)) {
          tex.source = remap.get(tex.source);
        }
        if (tex.extensions) {
          for (const ext of Object.values(tex.extensions)) {
            if (ext && ext.source !== undefined && remap.has(ext.source)) {
              ext.source = remap.get(ext.source);
            }
          }
        }
      }
    }
  }
}

/**
 * Add EXT_texture_avif extension references to the glTF JSON output.
 * Used in keep mode: original images are preserved, AVIF added as extension.
 * Matches by computing the expected AVIF URI from each image's URI in the output JSON,
 * which is robust against gltf-transform reorganizing texture/image indices.
 * @param {object} json - glTF JSON object
 * @param {object} resources - Resource map (uri -> Uint8Array) to add AVIF files to
 * @param {Array} avifData - Array of { originalUri, avifUri, data }
 */
function addAvifExtension(json, resources, avifData) {
  if (!avifData || avifData.length === 0) return;
  if (!json.images || !json.textures) return;

  // Build a lookup from avifUri to data
  const avifMap = new Map();
  for (const { avifUri, data } of avifData) {
    avifMap.set(avifUri, data);
  }

  // For each texture in the output, compute expected AVIF URI from its source image
  // and check if we have AVIF data for it
  const avifUriToImageIndex = new Map();
  let matched = 0;

  for (let ti = 0; ti < json.textures.length; ti++) {
    const tex = json.textures[ti];
    if (tex.source === undefined) continue;

    const img = json.images[tex.source];
    if (!img || !img.uri) continue;

    // Compute expected AVIF URI by replacing the file extension
    const dotIdx = img.uri.lastIndexOf(".");
    if (dotIdx === -1) continue;
    const avifUri = img.uri.substring(0, dotIdx) + ".avif";

    if (!avifMap.has(avifUri)) continue;

    // Get or create the AVIF image entry (dedup if same AVIF used by multiple textures)
    let avifImageIndex;
    if (avifUriToImageIndex.has(avifUri)) {
      avifImageIndex = avifUriToImageIndex.get(avifUri);
    } else {
      avifImageIndex = json.images.length;
      json.images.push({ uri: avifUri, mimeType: "image/avif" });
      resources[avifUri] = new Uint8Array(avifMap.get(avifUri));
      avifUriToImageIndex.set(avifUri, avifImageIndex);
    }

    if (!tex.extensions) tex.extensions = {};
    tex.extensions["EXT_texture_avif"] = { source: avifImageIndex };
    matched++;
  }

  // Add to extensionsUsed if we matched any textures
  if (matched > 0) {
    if (!json.extensionsUsed) json.extensionsUsed = [];
    if (!json.extensionsUsed.includes("EXT_texture_avif")) {
      json.extensionsUsed.push("EXT_texture_avif");
    }
  }
}

/**
 * Remove resources (files) that are no longer referenced by the glTF JSON.
 * This prevents writing orphaned files (e.g. DDS images after stripping MSFT_texture_dds).
 * @param {object} json - glTF JSON object
 * @param {object} resources - Resource map (uri -> Uint8Array) to clean up
 */
function cleanupResources(json, resources) {
  const referenced = new Set();

  if (json.images) {
    for (const img of json.images) {
      if (img.uri) referenced.add(img.uri);
    }
  }
  if (json.buffers) {
    for (const buf of json.buffers) {
      if (buf.uri) referenced.add(buf.uri);
    }
  }

  for (const uri of Object.keys(resources)) {
    if (!referenced.has(uri)) {
      delete resources[uri];
    }
  }
}

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
    keep: false, // Keep original images, add AVIF as extension
    "max-size": 0, // Max texture dimension (width/height), 0 = no limit
    "flip-normals": false, // Flip normal map Y (D3D → GL convention)
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
    const parsed = path.parse(inputPath);
    finalOutputPath = path.join(parsed.dir, `${parsed.name}-avif${parsed.ext}`);
    console.log(`Output file not specified, using: ${finalOutputPath}`);
  }

  // Keep mode is only supported for .gltf output
  let keep = options.keep;
  if (keep && finalOutputPath.endsWith(".glb")) {
    console.warn(
      "Warning: --keep mode is only supported for .gltf output. Using replace mode.",
    );
    keep = false;
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
  if (options["max-size"] > 0) {
    console.log(`Max texture size: ${options["max-size"]}px`);
  }
  if (keep) {
    console.log("Mode: keep (original images preserved, AVIF added as extension)");
  }

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
    const processorOptions = {
      quality: options.quality,
      speed: options.speed,
      debug: options.debug,
      concurrency: options.concurrency,
      keep,
      maxSize: options["max-size"],
      flipNormals: options["flip-normals"],
    };

    let avifData;
    if (options.sharp) {
      avifData = await processTexturesAVIFSharp(doc, inputPath, processorOptions);
    } else {
      avifData = await processTexturesAVIF(doc, inputPath, {
        ...processorOptions,
        blaze: options.blaze,
      });
    }

    // Remove DDS textures from the document — they are not needed alongside
    // AVIF and would bloat the output (especially for .glb where everything
    // is packed into a single binary).
    const allTextures = doc.getRoot().listTextures();
    for (const tex of allTextures) {
      if (isDDSMimeType(tex.getMimeType())) {
        tex.dispose();
      }
    }

    // Write the output file
    const isGltf = finalOutputPath.endsWith(".gltf");

    if (isGltf) {
      // For .gltf, use post-processing to handle extensions cleanly
      await writeGLTFProcessed(finalOutputPath, doc, (json, resources) => {
        // Strip MSFT_texture_dds from the JSON (extension refs, extensionsUsed)
        stripExtension(json, "MSFT_texture_dds");

        // In keep mode, add AVIF as extension references
        if (keep && avifData) {
          addAvifExtension(json, resources, avifData);
        }

        // Remove unreferenced resource files
        cleanupResources(json, resources);
      });
    } else {
      await writeGLTF(finalOutputPath, doc);
    }

    console.log(`✓ Successfully wrote ${finalOutputPath}`);
  } catch (error) {
    console.error(`Failed to process file: ${error.message}`);
    throw error;
  }
}
