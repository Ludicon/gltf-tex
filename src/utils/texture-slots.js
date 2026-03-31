import { listTextureSlots } from "@gltf-transform/functions";

/**
 * Build a map from Texture objects to their material slots.
 *
 * gltf-transform's `listTextureSlots` only works for textures that are directly
 * referenced by materials via the standard `source` field. Textures referenced
 * only through unregistered extensions (e.g. MSFT_texture_dds) appear with
 * empty slots.
 *
 * This function uses the raw glTF JSON to find multi-source texture entries
 * (where one glTF texture has both a standard source and extension sources)
 * and propagates slots from the standard source to all alternative sources.
 *
 * @param {import('@gltf-transform/core').Texture[]} textures - Texture objects from gltf-transform
 * @param {object} [json] - Raw glTF JSON (if available, enables multi-source propagation)
 * @returns {Map<import('@gltf-transform/core').Texture, string[]>}
 */
export function buildTextureSlotMap(textures, json) {
  const slotMap = new Map();

  // First pass: get slots from gltf-transform for all textures.
  for (const tex of textures) {
    slotMap.set(tex, listTextureSlots(tex));
  }

  // Second pass: if we have the raw JSON, propagate slots from standard
  // sources to their alternative sources within the same texture entry.
  if (json && json.textures && json.images) {
    // Build a map from image index to the Texture object that holds that image.
    // gltf-transform creates one Texture per image, and we can match them by URI.
    const uriToTexture = new Map();
    for (const tex of textures) {
      const uri = tex.getURI();
      if (uri) {
        uriToTexture.set(uri, tex);
      }
    }

    for (const jsonTex of json.textures) {
      // Collect all image indices for this texture entry
      const standardIdx = jsonTex.source;
      const altIndices = [];

      if (jsonTex.extensions) {
        for (const ext of Object.values(jsonTex.extensions)) {
          if (ext && typeof ext.source === "number") {
            altIndices.push(ext.source);
          }
        }
      }

      if (standardIdx === undefined || altIndices.length === 0) continue;

      // Find the Texture object for the standard source
      const standardImg = json.images[standardIdx];
      if (!standardImg || !standardImg.uri) continue;
      const standardTex = uriToTexture.get(standardImg.uri);
      if (!standardTex) continue;

      const slots = slotMap.get(standardTex);
      if (!slots || slots.length === 0) continue;

      // Propagate slots to all alternative sources
      for (const altIdx of altIndices) {
        const altImg = json.images[altIdx];
        if (!altImg || !altImg.uri) continue;
        const altTex = uriToTexture.get(altImg.uri);
        if (altTex && slotMap.get(altTex)?.length === 0) {
          slotMap.set(altTex, slots);
        }
      }
    }
  }

  return slotMap;
}

/**
 * Build a list of logical textures from the raw glTF JSON.
 *
 * Each glTF texture entry may reference multiple images (a standard source
 * plus alternative sources via extensions like MSFT_texture_dds). This function
 * returns one entry per glTF texture, with all image indices grouped together.
 *
 * @param {object} json - Raw glTF JSON
 * @returns {Array<{ standardImageIndex: number|undefined, altImageIndices: number[] }>}
 */
export function listLogicalTextures(json) {
  if (!json || !json.textures) return [];

  return json.textures.map((tex) => {
    const altImageIndices = [];
    if (tex.extensions) {
      for (const ext of Object.values(tex.extensions)) {
        if (ext && typeof ext.source === "number") {
          altImageIndices.push(ext.source);
        }
      }
    }
    return {
      standardImageIndex: tex.source,
      altImageIndices,
    };
  });
}
