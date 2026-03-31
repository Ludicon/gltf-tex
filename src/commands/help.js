let _version = null;

async function getVersion() {
  if (!_version) {
    const { readFile } = await import("node:fs/promises");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await readFile(join(__dirname, "..", "..", "package.json"), "utf8"));
    _version = pkg.version;
  }
  return _version;
}

export async function helpCommand(args) {
  const commandName = args[0];

  if (commandName) {
    // Show help for specific command
    showCommandHelp(commandName);
  } else {
    // Show general help
    const version = await getVersion();
    showGeneralHelp(version);
  }
}

function showGeneralHelp(version) {
  console.log(`
gltf-tex v${version} - Command-line tool for processing textures in glTF models

USAGE:
  gltf-tex <command> [options]

COMMANDS:
  help              Show this help message
  avif              Compress textures using AVIF format
  webp              Compress textures using WebP format
  size              Display texture size information in a glTF model
  dedup             Remove duplicate textures based on pixel data
  convert-pbr       Convert specular/glossiness materials to metallic/roughness

OPTIONS:
  -h, --help        Show help for a specific command

EXAMPLES:
  gltf-tex help avif
  gltf-tex avif input.glb output.glb --quality 90
  gltf-tex size model.glb

For more information about a specific command, run:
  gltf-tex help <command>
`);
}

function showCommandHelp(commandName) {
  const helpText = {
    avif: `
gltf-tex avif - Compress textures using AVIF format

USAGE:
  gltf-tex avif <input> [output] [options]

ARGUMENTS:
  <input>           Input glTF/GLB file path
  [output]          Output glTF/GLB file path (default: <input>-avif.glb)

OPTIONS:
  --quality <0-100>   Quality level for compression (default: 80)
  --speed <0-10>      Encoding speed: 0=slowest, 10=fastest (default: 4)
  --concurrency <1-32> Number of textures to process in parallel (default: 4)
  --keep              Keep original images, add AVIF as extension (.gltf only)
  --blaze             Use blaze_enc instead of avifenc (experimental)
  --debug             Keep intermediate files for debugging
  -h, --help          Show this help message

DESCRIPTION:
  Compresses all textures in the glTF model to AVIF format. The command
  automatically applies optimal encoding settings based on texture usage:
  - Normal maps: Identity color transform, SSIM tuning, normalized with Z channel cleared
  - Occlusion maps: Grayscale encoding (YUV 400)
  - Metallic/Roughness: Identity color transform, SSIM tuning
  - Base color/Emissive: YUV 4:4:4, IQ tuning

  By default, original images are replaced with AVIF. Use --keep to preserve
  the original images (PNG/JPEG) and add AVIF as an EXT_texture_avif extension
  reference. This provides a fallback for clients that don't support AVIF.
  The --keep option is only supported for .gltf output (not .glb).

  Textures with alternative format extensions (e.g. MSFT_texture_dds) are
  handled automatically: only the primary image (PNG/JPEG) is compressed,
  and the alternative format references are stripped from the output.

  Requires external tools: avifenc, imagemagick, dwebp (see installation guide).

  Advanced options:
  - Use --sharp flag to use the sharp npm package instead of native tools.
    This avoids external dependencies but provides different encoding characteristics.
  - Use --blaze flag to use blaze_enc encoder instead of avifenc (experimental).
    Blaze encoder provides different quality/performance trade-offs.

EXAMPLES:
  gltf-tex avif model.glb
  gltf-tex avif model.glb output.glb --quality 90 --speed 2
  gltf-tex avif scene.gltf --keep
  gltf-tex avif model.glb --blaze
  gltf-tex avif model.glb --debug
  gltf-tex avif model.glb --concurrency 8
`,
    webp: `
gltf-tex webp - Compress textures using WebP format

USAGE:
  gltf-tex webp <input> <output> [options]

ARGUMENTS:
  <input>           Input glTF/GLB file path
  <output>          Output glTF/GLB file path

OPTIONS:
  -h, --help        Show this help message

DESCRIPTION:
  Compresses all textures in the glTF model to WebP format.
  (This command is not yet fully implemented)

EXAMPLES:
  gltf-tex webp model.glb output.glb
`,
    size: `
gltf-tex size - Display texture size information in a glTF model

USAGE:
  gltf-tex size <input> [options]

ARGUMENTS:
  <input>           Input glTF/GLB file path

OPTIONS:
  --dds             Prefer DDS source when a texture has multiple sources
  -h, --help        Show this help message

DESCRIPTION:
  Displays detailed information about all textures in the glTF model:
  - Texture dimensions and format
  - Disk size (current file size)
  - Usage/slots (baseColor, normal, metallic/roughness, etc.)
  - Estimated video memory usage (GPU):
    * High quality: BC7/ASTC compression with mipmaps
    * Low quality: Lower bit-rate compression with mipmaps
    * Uncompressed: Raw RGBA without mipmaps

  When a texture has multiple sources (e.g. PNG + DDS via MSFT_texture_dds),
  only the preferred source is counted. By default the standard source (PNG/JPEG)
  is used. Pass --dds to report sizes using the DDS source instead.

EXAMPLES:
  gltf-tex size model.glb
  gltf-tex size scene.gltf --dds
  gltf-tex size assets/FlightHelmet.glb
`,
    dedup: `
gltf-tex dedup - Remove duplicate textures based on pixel data

USAGE:
  gltf-tex dedup <input> [output] [options]

ARGUMENTS:
  <input>           Input glTF/GLB file path
  [output]          Output glTF/GLB file path (default: <input>-dedup.glb)

OPTIONS:
  --verbose         Show detailed logging of deduplication process
  -h, --help        Show this help message

DESCRIPTION:
  Analyzes all textures in the glTF model and removes duplicates based on
  pixel data comparison. This command:

  1. Loads each texture's image data into memory
  2. Decodes the image to raw pixels (ignoring file metadata)
  3. Creates a hash of the pixel data + dimensions
  4. Identifies textures with identical pixel content
  5. Remaps all material references to point to a single copy
  6. Removes the duplicate textures

  This approach ignores differences in:
  - File format metadata (EXIF, PNG chunks, etc.)
  - Compression settings
  - File encoding

  Only actual pixel data is compared, making it effective at finding true
  duplicates even when stored in different formats or with different metadata.

EXAMPLES:
  gltf-tex dedup model.glb
  gltf-tex dedup model.glb output.glb
  gltf-tex dedup model.glb --verbose
`,
    "convert-pbr": `
gltf-tex convert-pbr - Convert specular/glossiness materials to metallic/roughness

USAGE:
  gltf-tex convert-pbr <input> [output] [options]

ARGUMENTS:
  <input>           Input glTF/GLB file path
  [output]          Output glTF/GLB file path (default: <input>-pbr.<ext>)

OPTIONS:
  -h, --help        Show this help message

DESCRIPTION:
  Converts materials using the deprecated KHR_materials_pbrSpecularGlossiness
  extension to the standard metallic/roughness workflow with KHR_materials_specular.

  The conversion works as follows:
  - diffuseTexture/Factor  -> baseColorTexture/Factor
  - specularFactor         -> KHR_materials_specular.specularColorFactor
  - specularGlossinessTexture (RGB) -> KHR_materials_specular.specularColorTexture
  - metallicFactor is set to 0

  For roughness (derived from glossiness):
  - If the specularGlossiness texture has constant alpha (or no texture),
    roughnessFactor is set to 1 - glossinessFactor. No new texture is generated.
  - If the specularGlossiness texture has varying alpha (per-pixel glossiness),
    a metallicRoughness texture is generated with roughness in the G channel.
    The new texture is placed alongside the original with a _mr suffix.

EXAMPLES:
  gltf-tex convert-pbr scene.gltf
  gltf-tex convert-pbr scene.gltf scene-converted.gltf
`,
  };

  if (helpText[commandName]) {
    console.log(helpText[commandName]);
  } else {
    console.error(`Unknown command: ${commandName}`);
    console.error('Run "gltf-tex help" for a list of available commands.');
    process.exit(1);
  }
}
