# gltf-tex Examples

This document provides detailed examples of using gltf-tex for various texture processing tasks.

## Basic Usage

### Compressing a Model with Default Settings

```bash
gltf-tex avif model.glb output.glb
```

This will compress all textures in `model.glb` using AVIF with default settings (quality: 80, speed: 4).

### High Quality Compression

For production assets where quality is paramount:

```bash
gltf-tex avif model.glb output.glb --quality 95 --speed 2
```

This uses higher quality (95) and slower encoding (speed 2) for better results.

### Fast Preview Compression

For quick previews or testing:

```bash
gltf-tex avif model.glb output.glb --quality 60 --speed 8
```

This uses lower quality (60) and faster encoding (speed 8) for quick turnaround.

## Advanced Usage

### Batch Processing

Process multiple models in a directory:

```bash
#!/bin/bash
for file in assets/*.glb; do
  basename=$(basename "$file" .glb)
  gltf-tex avif "$file" "output/${basename}-compressed.glb" --quality 85
done
```

### Different Quality Levels

Create multiple variants with different quality levels:

```bash
# High quality
gltf-tex avif model.glb model-hq.glb --quality 90 --speed 3

# Medium quality
gltf-tex avif model.glb model-mq.glb --quality 75 --speed 5

# Low quality
gltf-tex avif model.glb model-lq.glb --quality 50 --speed 8
```

## Quality vs Speed Trade-offs

### Speed Parameter (0-10)

- **0-2 (Slowest)**: Best quality, use for final production assets
  ```bash
  gltf-tex avif model.glb final.glb --quality 90 --speed 1
  ```

- **3-5 (Medium)**: Good balance, recommended for most cases
  ```bash
  gltf-tex avif model.glb output.glb --quality 80 --speed 4
  ```

- **6-10 (Fastest)**: Quick encoding, use for testing or low-priority assets
  ```bash
  gltf-tex avif model.glb test.glb --quality 70 --speed 8
  ```

### Quality Parameter (0-100)

- **90-100**: Near-lossless, large file sizes
- **80-90**: High quality, good for most production use
- **60-80**: Medium quality, balanced file size
- **40-60**: Lower quality, smaller files
- **0-40**: Very low quality, minimal file size

## Texture Type Considerations

### Models with Normal Maps

Normal maps are automatically detected and encoded with special settings for accuracy:

```bash
# Normal maps will use identity color transform and SSIM tuning
gltf-tex avif model-with-normals.glb output.glb --quality 85
```

### Models with Occlusion Maps

Occlusion maps are encoded as grayscale for efficiency:

```bash
# Occlusion-only textures use YUV 400 encoding
gltf-tex avif model-with-ao.glb output.glb --quality 80
```

### PBR Materials (Metallic/Roughness)

ORM textures are encoded with identity color transform:

```bash
# Metallic/roughness textures use optimized encoding
gltf-tex avif pbr-model.glb output.glb --quality 85
```

## Workflow Examples

### Complete Asset Pipeline

```bash
#!/bin/bash
# 1. Compress textures
gltf-tex avif source.glb compressed.glb --quality 85 --speed 4

# 2. Inspect results (when implemented)
# gltf-tex inspect compressed.glb

# 3. Compare file sizes
echo "Original size: $(du -h source.glb | cut -f1)"
echo "Compressed size: $(du -h compressed.glb | cut -f1)"
```

### Quality Comparison Script

Create multiple quality levels and compare:

```bash
#!/bin/bash
MODEL="model.glb"

for quality in 50 60 70 80 90; do
  output="model-q${quality}.glb"
  gltf-tex avif "$MODEL" "$output" --quality $quality --speed 4
  size=$(du -h "$output" | cut -f1)
  echo "Quality ${quality}: ${size}"
done
```

## Common Use Cases

### Web Optimization

For web delivery where file size matters:

```bash
gltf-tex avif model.glb web-optimized.glb --quality 75 --speed 5
```

### Mobile Optimization

For mobile devices with limited bandwidth:

```bash
gltf-tex avif model.glb mobile.glb --quality 65 --speed 6
```

### Desktop/High-End Optimization

For desktop or high-end devices:

```bash
gltf-tex avif model.glb desktop.glb --quality 85 --speed 3
```

### Archive/Master Quality

For archival or master copies:

```bash
gltf-tex avif model.glb archive.glb --quality 95 --speed 1
```

## Troubleshooting

### Command Not Found

If you get "command not found", ensure the tool is installed:

```bash
npm install
npm link
```

### Missing External Tools

The AVIF command requires external tools. Install them:

**macOS:**
```bash
brew install libavif imagemagick webp
```

**Ubuntu/Debian:**
```bash
sudo apt-get install libavif-bin imagemagick webp
```

Alternatively, you can use the `--sharp` flag to avoid external dependencies (though with slightly different encoding characteristics).

### Processing Fails

If processing fails, try with DEBUG mode:

```bash
DEBUG=1 gltf-tex avif model.glb output.glb
```

## Performance Tips

1. **Use appropriate speed settings**: Speed 4-6 offers the best balance
2. **Batch processing**: Process multiple files in parallel when possible
3. **Quality sweet spot**: 75-85 quality is usually sufficient for most use cases
4. **Test on target platform**: Always verify results on your target platform

## Integration with Build Tools

### npm scripts

Add to your `package.json`:

```json
{
  "scripts": {
    "compress": "gltf-tex avif src/model.glb dist/model.glb --quality 80",
    "compress:hq": "gltf-tex avif src/model.glb dist/model-hq.glb --quality 90 --speed 2",
    "compress:all": "npm run compress && npm run compress:hq"
  }
}
```

### Makefile

```makefile
MODELS = $(wildcard assets/*.glb)
COMPRESSED = $(patsubst assets/%.glb,dist/%-compressed.glb,$(MODELS))

all: $(COMPRESSED)

dist/%-compressed.glb: assets/%.glb
	gltf-tex avif $< $@ --quality 85 --speed 4

clean:
	rm -f dist/*-compressed.glb
```

## Programmatic Usage

You can also use gltf-tex as a library:

```javascript
import { processTexturesAVIF, readGLTF, writeGLTF } from 'gltf-tex';

async function compressModel(inputPath, outputPath) {
  const doc = await readGLTF(inputPath);
  
  await processTexturesAVIF(doc, inputPath, {
    quality: 85,
    speed: 4
  });
  
  await writeGLTF(outputPath, doc);
}

compressModel('model.glb', 'output.glb');
```

For distribution scenarios where you cannot rely on external tools, you can use the sharp-based processor:

```javascript
import { processTexturesAVIFSharp, readGLTF, writeGLTF } from 'gltf-tex';

async function compressModel(inputPath, outputPath) {
  const doc = await readGLTF(inputPath);
  
  await processTexturesAVIFSharp(doc, inputPath, {
    quality: 85,
    speed: 4
  });
  
  await writeGLTF(outputPath, doc);
}

compressModel('model.glb', 'output.glb');
```
