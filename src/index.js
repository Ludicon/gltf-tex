// Main exports for programmatic use of gltf-tex

// Command functions
export { avifCommand, } from "./commands/avif.js";
export { webpCommand, } from "./commands/webp.js";
export { blazeCommand, } from "./commands/blaze.js";
export { sizeCommand, } from "./commands/size.js";
export { helpCommand, } from "./commands/help.js";

// Processors
export {
  avifArgsForTexture,
  blazeArgsForTexture,
  processTextureAVIF,
  processTextureBlaze,
  processTexturesAVIF,
} from "./processors/avif.js";
export { avifOptionsForTexture, processTextureAVIFSharp, processTexturesAVIFSharp, } from "./processors/avif-sharp.js";

export { dedupTextures, } from "./processors/dedup.js";

// Utilities
export { parseArgs, validateRange, } from "./utils/args.js";
export { ensureDir, getFileExt, } from "./utils/file.js";
export { createIO, readGLTF, writeGLTF, } from "./utils/io.js";
export { run, } from "./utils/process.js";
export {
  estimateCompressedSize,
  formatBytes,
  getDimensionsFromImageBytes,
  getTextureInfo,
} from "./utils/texture-info.js";
