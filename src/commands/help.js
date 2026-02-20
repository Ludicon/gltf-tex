export function helpCommand(args) {
  const commandName = args[0];

  if (commandName) {
    // Show help for specific command
    showCommandHelp(commandName);
  } else {
    // Show general help
    showGeneralHelp();
  }
}

function showGeneralHelp() {
  console.log(`
gltf-tex - Command-line tool for processing textures in glTF models

USAGE:
  gltf-tex <command> [options]

COMMANDS:
  help              Show this help message
  avif              Compress textures using AVIF format
  blaze             Compress textures using Blaze AVIF encoder
  webp              Compress textures using WebP format
  size              Display texture size information in a glTF model
  dedup             Remove duplicate textures based on pixel data

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

  Requires external tools: avifenc, imagemagick, dwebp (see installation guide).

  Advanced options:
  - Use --sharp flag to use the sharp npm package instead of native tools.
    This avoids external dependencies but provides different encoding characteristics.
  - Use --blaze flag to use blaze_enc encoder instead of avifenc (experimental).
    Blaze encoder provides different quality/performance trade-offs.

EXAMPLES:
  gltf-tex avif model.glb
  gltf-tex avif model.glb output.glb --quality 90 --speed 2
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

EXAMPLES:
  gltf-tex size model.glb
  gltf-tex size assets/FlightHelmet.glb
`,
    blaze: `
gltf-tex blaze - Compress textures using Blaze AVIF encoder

USAGE:
  gltf-tex blaze <input> [output] [options]

ARGUMENTS:
  <input>                       Input glTF/GLB file path
  [output]                      Output glTF/GLB file path (default: <input>-blaze.glb)

OPTIONS:
  --quality <0-100>             Quantizer value (default: 50)
  --speed <0-10>                Encoder speed: 0=slowest, 10=fastest (default: 4)
  --quality-alpha <0-100>       Quality factor for alpha, 100=lossless (default: 100)
  --max-threads <1-255>         Maximum number of threads to use (default: auto)
  --tile-rows-log2 <0-6>        Tile rows log2 (default: auto-tiling)
  --tile-cols-log2 <0-6>        Tile columns log2 (default: auto-tiling)
  --auto-tiling <true/false>    Enable automatic tiling (default: true)
  --tenbit <true/false>         Force 10-bit output (default: true)
  --tune <mode>                 Tuning mode: ssim, iq, ssimulacra2, psnr (default: auto based on texture)
  --hint <type>                 Texture hint: albedo, normal, displacement, roughness, opacity, metalness, orm (default: auto based on texture)
  --color-primaries <1-22>      Color primaries CICP value (default: 2)
  --transfer-characteristics <1-18>  Transfer characteristics CICP value (default: 2)
  --matrix-coeffs <0-14>        Matrix coefficients CICP value (default: 2)
  --concurrency <1-32>          Number of textures to process in parallel (default: 4)
  --debug                       Keep intermediate files for debugging
  -h, --help                    Show this help message

DESCRIPTION:
  Compresses all textures in the glTF model using Blaze AVIF encoder.
  Blaze is optimized for texture compression and provides advanced options
  for fine-tuning encoding parameters.

  Texture hints and tuning modes are automatically selected based on texture usage:
  - Normal maps: hint=normal, tune=ssim
  - Metallic/Roughness (ORM): hint=orm, tune=ssim
  - All other textures: hint=albedo, tune=iq

  Use --hint or --tune to override automatic selection.

  The --quality-alpha option controls alpha channel quality. Setting it to 100
  (default) provides lossless alpha, which is recommended for textures with
  transparency.

EXAMPLES:
  gltf-tex blaze model.glb
  gltf-tex blaze model.glb output.glb --quality 80 --speed 2
  gltf-tex blaze model.glb --tune ssimulacra2 --tenbit false
  gltf-tex blaze model.glb --hint normal --quality 40
  gltf-tex blaze model.glb --debug
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
  };

  if (helpText[commandName]) {
    console.log(helpText[commandName]);
  } else {
    console.error(`Unknown command: ${commandName}`);
    console.error('Run "gltf-tex help" for a list of available commands.');
    process.exit(1);
  }
}
