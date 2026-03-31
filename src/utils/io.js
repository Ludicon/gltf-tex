import fs from "node:fs/promises";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshGPUInstancing,
  EXTMeshoptCompression,
  EXTTextureAVIF,
  EXTTextureWebP,
  KHRDracoMeshCompression,
  KHRLightsPunctual,
  KHRMaterialsAnisotropy,
  KHRMaterialsClearcoat,
  KHRMaterialsDiffuseTransmission,
  KHRMaterialsDispersion,
  KHRMaterialsEmissiveStrength,
  KHRMaterialsIOR,
  KHRMaterialsIridescence,
  KHRMaterialsPBRSpecularGlossiness,
  KHRMaterialsSheen,
  KHRMaterialsSpecular,
  KHRMaterialsTransmission,
  KHRMaterialsUnlit,
  KHRMaterialsVariants,
  KHRMaterialsVolume,
  KHRMeshQuantization,
  KHRTextureBasisu,
  KHRTextureTransform,
} from "@gltf-transform/extensions";

import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import draco3d from "draco3dgltf";

/**
 * Create a configured NodeIO instance for reading/writing glTF files
 * @returns {Promise<NodeIO>} Configured NodeIO instance
 */
export async function createIO() {
  const io = new NodeIO().registerExtensions([
    // Texture formats
    EXTTextureAVIF,
    EXTTextureWebP,
    KHRTextureBasisu,
    KHRTextureTransform,
    // Material extensions (needed for accurate texture slot detection)
    KHRMaterialsAnisotropy,
    KHRMaterialsClearcoat,
    KHRMaterialsDiffuseTransmission,
    KHRMaterialsDispersion,
    KHRMaterialsEmissiveStrength,
    KHRMaterialsIOR,
    KHRMaterialsIridescence,
    KHRMaterialsPBRSpecularGlossiness,
    KHRMaterialsSheen,
    KHRMaterialsSpecular,
    KHRMaterialsTransmission,
    KHRMaterialsUnlit,
    KHRMaterialsVariants,
    KHRMaterialsVolume,
    // Mesh compression
    EXTMeshGPUInstancing,
    EXTMeshoptCompression,
    KHRDracoMeshCompression,
    KHRMeshQuantization,
    // Other
    KHRLightsPunctual,
  ]);

  io.registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });

  const decoderModule = await draco3d.createDecoderModule();
  const encoderModule = await draco3d.createEncoderModule();

  io.registerDependencies({
    "draco3d.decoder": decoderModule,
    "draco3d.encoder": encoderModule,
  });

  return io;
}

/**
 * Read a glTF file
 * @param {string} filePath - Path to glTF/GLB file
 * @returns {Promise<import('@gltf-transform/core').Document>} glTF document
 */
export async function readGLTF(filePath) {
  const io = await createIO();
  return io.read(filePath);
}

/**
 * Read the raw JSON from a glTF/GLB file without full parsing.
 * Useful for inspecting structure that gltf-transform's Document model doesn't expose
 * (e.g. MSFT_texture_dds source mappings).
 * @param {string} filePath - Path to glTF/GLB file
 * @returns {Promise<object>} Raw glTF JSON
 */
export async function readGLTFJson(filePath) {
  const io = await createIO();
  const jsonDoc = await io.readAsJSON(filePath);
  return jsonDoc.json;
}

/**
 * Write a glTF file
 * @param {string} path - Path to output glTF/GLB file
 * @param {import('@gltf-transform/core').Document} doc - glTF document
 * @returns {Promise<void>}
 */
export async function writeGLTF(filePath, doc) {
  const io = await createIO();

  // For .gltf, rename the .bin buffer to match the output filename
  // so we never overwrite the original binary.
  if (!filePath.endsWith(".glb")) {
    const outBaseName = path.basename(filePath, path.extname(filePath));
    for (const buf of doc.getRoot().listBuffers()) {
      const uri = buf.getURI();
      if (uri && uri.endsWith(".bin")) {
        buf.setURI(`${outBaseName}.bin`);
      }
    }
  }

  await io.write(filePath, doc);
}

/**
 * Write a glTF file with optional JSON post-processing.
 * For .gltf files, allows modifying the JSON and adding extra resources before writing.
 * For .glb files, falls back to normal write (no post-processing).
 * @param {string} filePath - Path to output glTF/GLB file
 * @param {import('@gltf-transform/core').Document} doc - glTF document
 * @param {function} [postProcess] - Optional callback: (json, resources) => void
 * @returns {Promise<void>}
 */
export async function writeGLTFProcessed(filePath, doc, postProcess) {
  const io = await createIO();

  if (filePath.endsWith(".glb")) {
    await io.write(filePath, doc);
    return;
  }

  // For .gltf, get the JSON document so we can modify it
  const jsonDoc = await io.writeJSON(doc);
  const json = jsonDoc.json;

  // Rename .bin buffers to match the output filename so we never overwrite
  // the original binary when the output sits in the same directory.
  const outBaseName = path.basename(filePath, path.extname(filePath));
  if (json.buffers) {
    for (const buf of json.buffers) {
      if (buf.uri && buf.uri.endsWith(".bin")) {
        const oldUri = buf.uri;
        const newUri = `${outBaseName}.bin`;
        if (oldUri !== newUri) {
          buf.uri = newUri;
          if (oldUri in jsonDoc.resources) {
            jsonDoc.resources[newUri] = jsonDoc.resources[oldUri];
            delete jsonDoc.resources[oldUri];
          }
        }
      }
    }
  }

  if (postProcess) {
    postProcess(json, jsonDoc.resources);
  }

  // Write JSON file
  const outDir = path.dirname(filePath);
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(json, null, 2));

  // Write resource files (bin, images, etc.)
  for (const [uri, data] of Object.entries(jsonDoc.resources)) {
    const resourcePath = path.join(outDir, uri);
    await fs.mkdir(path.dirname(resourcePath), { recursive: true });
    await fs.writeFile(resourcePath, Buffer.from(data));
  }
}
