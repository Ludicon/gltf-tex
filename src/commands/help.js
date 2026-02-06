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
  webp              Compress textures using WebP format
  inspect           Inspect texture information in a glTF model

OPTIONS:
  -h, --help        Show help for a specific command

EXAMPLES:
  gltf-tex help avif
  gltf-tex avif input.glb output.glb --quality 90
  gltf-tex inspect model.glb

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
    inspect: `
gltf-tex inspect - Inspect texture information in a glTF model

USAGE:
  gltf-tex inspect <input> [options]

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
  gltf-tex inspect model.glb
  gltf-tex inspect assets/FlightHelmet.glb
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
