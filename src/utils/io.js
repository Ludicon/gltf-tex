import { NodeIO, } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  EXTTextureAVIF,
  EXTTextureWebP,
  KHRDracoMeshCompression,
  KHRLightsPunctual,
  KHRMaterialsClearcoat,
  KHRMaterialsIOR,
  KHRMaterialsSheen,
  KHRMaterialsTransmission,
  KHRMaterialsUnlit,
  KHRMaterialsVariants,
  KHRMaterialsVolume,
  KHRMeshQuantization,
  KHRTextureBasisu,
  KHRTextureTransform,
} from "@gltf-transform/extensions";

import { MeshoptDecoder, MeshoptEncoder, } from "meshoptimizer";
import draco3d from "draco3dgltf";

/**
 * Create a configured NodeIO instance for reading/writing glTF files
 * @returns {Promise<NodeIO>} Configured NodeIO instance
 */
export async function createIO() {
  const io = new NodeIO().registerExtensions([
    EXTTextureAVIF,
    EXTTextureWebP,
    KHRTextureBasisu,
    KHRMaterialsClearcoat,
    KHRMaterialsIOR,
    KHRMaterialsTransmission,
    KHRMaterialsVariants,
    KHRMaterialsVolume,
    KHRMaterialsSheen,
    KHRMaterialsUnlit,
    KHRTextureTransform,
    EXTMeshoptCompression,
    KHRMeshQuantization,
    KHRLightsPunctual,
    KHRDracoMeshCompression,
  ],);

  io.registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  },);

  const decoderModule = await draco3d.createDecoderModule();
  const encoderModule = await draco3d.createEncoderModule();

  io.registerDependencies({
    "draco3d.decoder": decoderModule,
    "draco3d.encoder": encoderModule,
  },);

  return io;
}

/**
 * Read a glTF file
 * @param {string} path - Path to glTF/GLB file
 * @returns {Promise<import('@gltf-transform/core').Document>} glTF document
 */
export async function readGLTF(path,) {
  const io = await createIO();
  return io.read(path,);
}

/**
 * Write a glTF file
 * @param {string} path - Path to output glTF/GLB file
 * @param {import('@gltf-transform/core').Document} doc - glTF document
 * @returns {Promise<void>}
 */
export async function writeGLTF(path, doc,) {
  const io = await createIO();
  await io.write(path, doc,);
}
