# gltf-tex

A command-line tool for processing textures in glTF models, focused on texture compression and analysis.

## Features

- **AVIF Compression**: Compress textures using AVIF format with optimized settings per texture type
- **WebP Compression**: (Coming soon) Compress textures using WebP format
- **Blaze Compression**: (Coming soon) Compress textures using Blaze format
- **Texture Inspection**: Analyze texture information and memory usage

## Installation

```bash
npm install
npm link
```

## Usage

```bash
gltf-tex <command> [options]
```

### Commands

#### `help`
Show help information for all commands or a specific command.

```bash
gltf-tex help
gltf-tex help avif
```

#### `avif`
Compress textures using AVIF format with optimal encoding settings based on texture usage.

```bash
gltf-tex avif <input> [output] [options]
```

**Options:**
- `--quality <0-100>`: Quality level for compression (default: 80)
- `--speed <0-10>`: Encoding speed: 0=slowest, 10=fastest (default: 4)
- `--sharp`: Use sharp (npm package) instead of native avifenc (optional)
- `--blaze`: Use blaze_enc instead of avifenc (experimental)
- `--debug`: Keep intermediate files for debugging

**Examples:**
```bash
# Compress with default settings (output: model-avif.glb)
gltf-tex avif model.glb

# Specify output file
gltf-tex avif model.glb output.glb

# High quality, slower encoding
gltf-tex avif model.glb --quality 95 --speed 2

# Lower quality, faster encoding
gltf-tex avif model.glb --quality 60 --speed 8

# Debug mode (keeps intermediate files)
gltf-tex avif model.glb --debug

# Use Blaze encoder (experimental)
gltf-tex avif model.glb --blaze
```

**Encoding Details:**

The AVIF encoder automatically applies optimal settings based on texture type:
- **Normal maps**: Identity color transform, SSIM tuning, normalized with Z channel cleared
- **Occlusion maps**: Grayscale encoding (YUV 400)
- **Metallic/Roughness maps**: Identity color transform, SSIM tuning
- **Base color/Emissive maps**: YUV 4:4:4, IQ tuning

**Advanced Options:**

- The `--sharp` flag allows using the sharp npm package instead of native tools. This can be useful for distribution scenarios where installing external dependencies is difficult, though it provides slightly different encoding characteristics and fewer tuning options.

- The `--blaze` flag uses the blaze_enc encoder instead of avifenc (experimental). Blaze encoder provides different quality/performance trade-offs and requires the `blaze_enc` command to be available in your PATH.

#### `webp`
Compress textures using WebP format. *(Not yet implemented)*

```bash
gltf-tex webp <input> <output>
```

#### `inspect`
Inspect texture information in a glTF model, including dimensions, formats, sizes, and estimated video memory usage.

```bash
gltf-tex inspect <input>
```

**Description:**

Displays detailed information about all textures including:
- Texture dimensions and format
- Disk size (current file size)
- Usage/slots (baseColor, normal, metallic/roughness, etc.)
- Estimated video memory usage (GPU):
  - High quality: BC7/ASTC compression with mipmaps
  - Low quality: Lower bit-rate compression with mipmaps
  - Uncompressed: Raw RGBA without mipmaps

**Examples:**
```bash
gltf-tex inspect model.glb
gltf-tex inspect assets/FlightHelmet.glb
```

## Requirements

### Native Tools (Recommended)

The AVIF command requires the following external tools to be installed:

- **avifenc**: AVIF encoder (from libavif)
- **magick**: ImageMagick for image preprocessing
- **dwebp**: WebP decoder (from libwebp, if processing WebP textures)

**macOS (using Homebrew):**
```bash
brew install libavif imagemagick webp
```

**Ubuntu/Debian:**
```bash
apt-get install libavif-bin imagemagick webp
```

### Alternative: Using Sharp (Optional)

If you cannot install external tools, you can use the `--sharp` flag which uses the sharp npm package bundled with the tool:

```bash
gltf-tex avif model.glb output.glb --sharp
```

Note: This provides slightly different encoding characteristics than native avifenc.

## Project Structure

```
gltf-tex/
├── bin/
│   └── gltf-tex.js          # CLI entry point
├── src/
│   ├── commands/            # Command implementations
│   │   ├── help.js
│   │   ├── avif.js
│   │   ├── webp.js
│   │   └── inspect.js
│   ├── processors/          # Texture processing logic
│   │   └── avif.js
│   └── utils/               # Utility functions
│       ├── args.js          # Argument parsing
│       ├── file.js          # File utilities
│       ├── io.js            # glTF I/O
│       └── process.js       # Process spawning
├── assets/                  # Test assets
├── package.json
└── README.md
```

## Development

### Adding New Commands

1. Create a new file in `src/commands/`
2. Implement the command function
3. Register it in `bin/gltf-tex.js`

Example:
```javascript
export async function myCommand(args) {
  const options = parseArgs(args);
  // Command implementation
}
```

## License

MIT
