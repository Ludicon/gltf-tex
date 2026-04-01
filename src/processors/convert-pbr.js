import path from "node:path";
import sharp from "sharp";

/**
 * Analyze an image's alpha channel.
 * Returns { constant, meanAlpha } where constant is true if all alpha values
 * are within ±tolerance of the mean (i.e. effectively flat).
 * @param {Uint8Array|Buffer} imageBuffer - Raw image data
 * @param {number} [tolerance=8] - Max deviation (0-255) to consider constant
 * @returns {Promise<{ constant: boolean, meanAlpha: number }>}
 */
async function analyzeAlpha(imageBuffer, tolerance = 8) {
  const { data, info } = await sharp(imageBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels < 4) return { constant: true, meanAlpha: 1.0 };

  let min = 255;
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let i = 3; i < data.length; i += info.channels) {
    const a = data[i];
    if (a < min) min = a;
    if (a > max) max = a;
    sum += a;
    count++;
  }

  return {
    constant: (max - min) <= tolerance,
    meanAlpha: count > 0 ? (sum / count) / 255 : 1.0,
  };
}

/**
 * Generate a metallicRoughness texture from a specularGlossiness texture (exact mode).
 * Bakes glossinessFactor into the texture: G = 1 - glossinessFactor * alpha.
 * Produces exact results but requires a separate texture per glossinessFactor value.
 * @param {Uint8Array|Buffer} sgBuffer - specularGlossiness image data
 * @param {number} glossinessFactor - glossiness scalar factor
 * @returns {Promise<Buffer>} PNG-encoded metallicRoughness image
 */
async function generateMetallicRoughnessTextureExact(sgBuffer, glossinessFactor) {
  const { data, info } = await sharp(sgBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);

  for (let i = 0; i < data.length; i += channels) {
    const px = (i / channels) * 4;
    const alpha = data[i + 3] / 255;
    const roughness = 1.0 - glossinessFactor * alpha;
    out[px + 0] = 0;
    out[px + 1] = Math.round(Math.max(0, Math.min(1, roughness)) * 255);
    out[px + 2] = 0;
    out[px + 3] = 255;
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * Generate a metallicRoughness texture from a specularGlossiness texture.
 * Output: R=0, G=1-alpha (inverted glossiness), B=0 (metallic=0).
 * The glossinessFactor is NOT baked in — it becomes roughnessFactor on the material,
 * so a single MR texture can be shared across materials with different factors.
 * Note: this is an approximation. roughnessFactor * (1 - alpha) != 1 - glossinessFactor * alpha.
 * @param {Uint8Array|Buffer} sgBuffer - specularGlossiness image data
 * @returns {Promise<Buffer>} PNG-encoded metallicRoughness image
 */
async function generateMetallicRoughnessTexture(sgBuffer) {
  const { data, info } = await sharp(sgBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);

  for (let i = 0; i < data.length; i += channels) {
    const px = (i / channels) * 4;
    out[px + 0] = 0;                   // R: unused
    out[px + 1] = 255 - data[i + 3];   // G: roughness = 1 - glossiness
    out[px + 2] = 0;                   // B: metallic = 0
    out[px + 3] = 255;                 // A: opaque
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}


/**
 * Generate a metallicRoughness texture by transferring the alpha channel
 * directly into the G (roughness) channel without inversion.
 * Used in --reinterpret mode where glossiness alpha is treated as roughness.
 * @param {Uint8Array|Buffer} sgBuffer - specularGlossiness image data
 * @returns {Promise<Buffer>} PNG-encoded metallicRoughness image
 */
async function generateMetallicRoughnessTextureReinterpret(sgBuffer) {
  const { data, info } = await sharp(sgBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const out = Buffer.alloc(width * height * 4);

  for (let i = 0; i < data.length; i += channels) {
    const px = (i / channels) * 4;
    out[px + 0] = 0;                // R: unused
    out[px + 1] = data[i + 3];      // G: roughness = alpha (no inversion)
    out[px + 2] = 0;                // B: metallic = 0
    out[px + 3] = 255;              // A: opaque
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * Convert all KHR_materials_pbrSpecularGlossiness materials to
 * standard metallicRoughness + KHR_materials_ior + KHR_materials_specular.
 *
 * Following the approach from gltf-transform's metalRough transform:
 * - IOR is set to 1000 (effectively infinity) so that the specular extension
 *   has full control over F0 reflectance.
 * - metallicFactor = 0, roughnessFactor derived from glossiness.
 * - Specular color/factor from the spec/gloss extension.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @param {object} [options]
 * @param {boolean} [options.exact=false] - Bake glossinessFactor into MR textures for exact results.
 * @param {boolean} [options.reinterpret=false] - Treat glossiness alpha as roughness directly (no inversion).
 * @returns {Promise<{ converted: number, texturesGenerated: number }>}
 */
export async function convertSpecGlossToMetalRough(doc, options = {}) {
  const { exact = false, reinterpret = false } = options;
  const {
    KHRMaterialsPBRSpecularGlossiness,
    KHRMaterialsSpecular,
    KHRMaterialsIOR,
  } = await import("@gltf-transform/extensions");

  const root = doc.getRoot();
  const materials = root.listMaterials();

  const iorExt = doc.createExtension(KHRMaterialsIOR);
  const specExt = doc.createExtension(KHRMaterialsSpecular);

  let converted = 0;
  let texturesGenerated = 0;

  // Cache generated MR textures to reuse across materials.
  const mrCache = new Map();
  const usedMRUris = new Map();

  for (const mat of materials) {
    const sg = mat.getExtension("KHR_materials_pbrSpecularGlossiness");
    if (!sg) continue;

    // --- Read spec/gloss properties ---
    const diffuseFactor = sg.getDiffuseFactor(); // vec4
    const diffuseTex = sg.getDiffuseTexture();
    const diffuseTexInfo = sg.getDiffuseTextureInfo();
    const specularFactor = sg.getSpecularFactor(); // vec3
    const glossinessFactor = sg.getGlossinessFactor(); // number
    const sgTex = sg.getSpecularGlossinessTexture();
    const sgTexInfo = sg.getSpecularGlossinessTextureInfo();

    // --- Set base metallic-roughness properties ---
    // IOR=1000 gives KHR_materials_specular full control over F0 reflectance.
    // See: https://github.com/KhronosGroup/glTF/pull/1719#issuecomment-674365677
    mat
      .setBaseColorFactor(diffuseFactor)
      .setMetallicFactor(0)
      .setRoughnessFactor(1)
      .setExtension("KHR_materials_ior", iorExt.createIOR().setIOR(1000));

    // Move diffuse -> baseColor, preserving texture info (UV set, transform).
    if (diffuseTex) {
      mat.setBaseColorTexture(diffuseTex);
      if (diffuseTexInfo) {
        mat.getBaseColorTextureInfo().copy(diffuseTexInfo);
      }
    }

    // --- Handle roughness from glossiness ---
    let needsMRTexture = false;
    let meanAlpha = 1.0;
    if (sgTex) {
      const sgImage = sgTex.getImage();
      if (sgImage) {
        const alpha = await analyzeAlpha(sgImage);
        meanAlpha = alpha.meanAlpha;
        needsMRTexture = !alpha.constant;
      }
    }

    if (needsMRTexture) {
      // In reinterpret and default modes, the MR texture is per source texture.
      // In exact mode, it's per (source texture, glossinessFactor) pair.
      const cacheKey = exact
        ? `${sgTex.getName() || sgTex.getURI()}:${glossinessFactor}`
        : sgTex;
      let mrTex = mrCache.get(cacheKey);

      if (!mrTex) {
        const sgImage = sgTex.getImage();
        let mrBuffer;
        if (reinterpret) {
          mrBuffer = await generateMetallicRoughnessTextureReinterpret(sgImage);
        } else if (exact) {
          mrBuffer = await generateMetallicRoughnessTextureExact(sgImage, glossinessFactor);
        } else {
          mrBuffer = await generateMetallicRoughnessTexture(sgImage);
        }

        mrTex = doc.createTexture();
        mrTex.setImage(mrBuffer);
        mrTex.setMimeType("image/png");

        const sgUri = sgTex.getURI();
        if (sgUri) {
          const dir = path.dirname(sgUri);
          const base = path.basename(sgUri, path.extname(sgUri));
          const baseMRUri = path.join(dir, `${base}_mr.png`).replace(/\\/g, "/");

          let mrUri = baseMRUri;
          if (exact) {
            const count = usedMRUris.get(baseMRUri) || 0;
            if (count > 0) {
              mrUri = path.join(dir, `${base}_mr${count + 1}.png`).replace(/\\/g, "/");
            }
            usedMRUris.set(baseMRUri, count + 1);
          }

          mrTex.setURI(mrUri);
        }

        mrCache.set(cacheKey, mrTex);
        texturesGenerated++;

        console.log(
          `  Generated metallicRoughness texture: ${mrTex.getURI() || "(embedded)"}`,
        );
      }

      mat.setMetallicRoughnessTexture(mrTex);
      if (sgTexInfo) {
        mat.getMetallicRoughnessTextureInfo().copy(sgTexInfo);
      }
      // reinterpret & default: glossinessFactor scales the texture value.
      // exact: factor is baked into the texture, roughnessFactor = 1.
      mat.setRoughnessFactor(exact ? 1.0 : glossinessFactor);
    } else {
      // No texture needed — alpha is constant, so use a scalar roughness.
      if (reinterpret) {
        mat.setRoughnessFactor(glossinessFactor * meanAlpha);
      } else {
        mat.setRoughnessFactor(1.0 - glossinessFactor * meanAlpha);
      }
    }

    // --- Set KHR_materials_specular ---
    const specular = specExt.createSpecular();
    specular.setSpecularFactor(1.0);
    specular.setSpecularColorFactor(specularFactor);

    if (sgTex) {
      // Reuse the original specGloss texture for specular color/factor.
      // Loaders only read RGB from these slots; the glossiness in alpha is ignored.
      specular.setSpecularTexture(sgTex);
      specular.setSpecularColorTexture(sgTex);
      if (sgTexInfo) {
        specular.getSpecularTextureInfo().copy(sgTexInfo);
        specular.getSpecularColorTextureInfo().copy(sgTexInfo);
      }
    }

    mat.setExtension("KHR_materials_specular", specular);

    // --- Remove the old extension ---
    mat.setExtension("KHR_materials_pbrSpecularGlossiness", null);

    converted++;
  }

  // If no materials use specGloss anymore, dispose the extension
  const sgExtInstance = root
    .listExtensionsUsed()
    .find(
      (e) => e.extensionName === "KHR_materials_pbrSpecularGlossiness",
    );
  if (sgExtInstance) {
    sgExtInstance.dispose();
  }

  return { converted, texturesGenerated };
}
