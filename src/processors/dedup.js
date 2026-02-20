import crypto from "node:crypto";
import sharp from "sharp";
import { formatBytes, } from "../utils/texture-info.js";
import { Buffer, } from "node:buffer";

/**
 * Create a hash of image pixel data
 * @param {Buffer} imageBuffer - Image buffer
 * @returns {Promise<string>} Hash of the pixel data
 */
async function hashImageData(imageBuffer,) {
  // Decode image to raw pixel data using sharp
  const { data, info, } = await sharp(imageBuffer,)
    .raw()
    .toBuffer({ resolveWithObject: true, },);

  // Create a hash that includes dimensions and pixel data
  const hash = crypto.createHash("sha256",);
  hash.update(Buffer.from(`${info.width}x${info.height}x${info.channels}`,),);
  hash.update(data,);

  return hash.digest("hex",);
}

/**
 * Find all materials that reference a specific texture
 * @param {import('@gltf-transform/core').Document} doc - glTF document
 * @param {import('@gltf-transform/core').Texture} texture - Texture to find references for
 * @returns {Array<{material: object, slot: string}>} Array of material references
 */
function findTextureReferences(doc, texture,) {
  const references = [];
  const root = doc.getRoot();
  const materials = root.listMaterials();

  for (const material of materials) {
    // Check all possible texture slots
    const slots = [
      { getter: "getBaseColorTexture", name: "baseColorTexture", },
      { getter: "getNormalTexture", name: "normalTexture", },
      { getter: "getOcclusionTexture", name: "occlusionTexture", },
      { getter: "getEmissiveTexture", name: "emissiveTexture", },
      {
        getter: "getMetallicRoughnessTexture",
        name: "metallicRoughnessTexture",
      },
    ];

    for (const slot of slots) {
      const slotTexture = material[slot.getter]();
      if (slotTexture === texture) {
        references.push({ material, slot: slot.name, },);
      }
    }
  }

  return references;
}

/**
 * Remove duplicate textures from a glTF document
 * @param {import('@gltf-transform/core').Document} doc - glTF document
 * @param {object} options - Processing options
 * @param {boolean} options.verbose - Show detailed logging (default: false)
 * @returns {Promise<{removed: number, kept: number, totalSize: number, dedupedSize: number}>}
 */
export async function dedupTextures(doc, options = {},) {
  const { verbose = false, } = options;

  const root = doc.getRoot();
  const textures = root.listTextures();

  console.log(`Analyzing ${textures.length} texture(s) for duplicates...\n`,);

  // Build hash map: hash -> { texture, size, name }
  const hashMap = new Map();
  const textureHashes = new Map();
  let totalSize = 0;

  // Phase 1: Hash all textures
  for (let i = 0; i < textures.length; i++) {
    const texture = textures[i];
    const image = texture.getImage();

    if (!image) {
      if (verbose) {
        console.log(
          `  Skipping texture ${texture.getName() || `tex_${i}`} (no image data)`,
        );
      }
      continue;
    }

    const name = texture.getName() || `tex_${i}`;
    const size = image.length;
    totalSize += size;

    try {
      if (verbose) {
        console.log(`  Hashing texture ${name}...`,);
      }

      const hash = await hashImageData(image,);
      textureHashes.set(texture, hash,);

      if (!hashMap.has(hash,)) {
        // First occurrence of this hash
        hashMap.set(hash, {
          texture,
          size,
          name,
          count: 1,
        },);
      } else {
        // Duplicate found
        hashMap.get(hash,).count++;
      }
    } catch (error) {
      console.error(`  ✗ Failed to hash ${name}: ${error.message}`,);
    }
  }

  // Phase 2: Find duplicates and remap references
  const duplicates = [];
  let removedCount = 0;
  let dedupedSize = 0;

  for (const [hash, entry,] of hashMap.entries()) {
    if (entry.count > 1) {
      duplicates.push({ hash, ...entry, },);
    }
  }

  if (duplicates.length === 0) {
    console.log("✓ No duplicate textures found\n",);
    return {
      removed: 0,
      kept: textures.length,
      totalSize,
      dedupedSize: 0,
    };
  }

  console.log(
    `Found ${duplicates.length} unique texture(s) with duplicates:\n`,
  );

  for (const dup of duplicates) {
    console.log(`  ${dup.name} - ${dup.count} copies`,);

    // Find all textures with this hash
    const texturesToMerge = [];
    for (const [texture, hash,] of textureHashes.entries()) {
      if (hash === dup.hash) {
        texturesToMerge.push(texture,);
      }
    }

    // Keep the first one, remap all others to it
    const [keepTexture, ...removeTextures] = texturesToMerge;

    for (const removeTexture of removeTextures) {
      // Find all references to the duplicate texture
      const references = findTextureReferences(doc, removeTexture,);

      if (verbose) {
        const removeName = removeTexture.getName() || "(unnamed)";
        console.log(
          `    Remapping ${removeName} (${references.length} references) -> ${dup.name}`,
        );
      }

      // Remap all references to point to the kept texture
      for (const { material, slot, } of references) {
        const setterName = `set${slot.charAt(0,).toUpperCase()}${slot.slice(1,)}`;
        material[setterName](keepTexture,);
      }

      // Remove the duplicate texture
      removeTexture.dispose();
      removedCount++;
      dedupedSize += dup.size;
    }
  }

  console.log(`\n✓ Removed ${removedCount} duplicate texture(s)`,);
  console.log(`  Kept: ${textures.length - removedCount} unique textures`,);
  console.log(`  Space saved: ${formatBytes(dedupedSize,)}`,);

  return {
    removed: removedCount,
    kept: textures.length - removedCount,
    totalSize,
    dedupedSize,
  };
}
