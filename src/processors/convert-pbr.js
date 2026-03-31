import path from "node:path";
import sharp from "sharp";

/**
 * Analyze an image's alpha channel.
 * Returns { constant, meanAlpha } where constant is true if all alpha values
 * are within ±tolerance of the mean (i.e. effectively flat).
 * @param {Uint8Array|Buffer} imageBuffer - Raw image data
 * @param {number} [tolerance=2] - Max deviation (0-255) to consider constant
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
 * Generate a metallicRoughness texture from a specularGlossiness texture.
 * Output: R=0, G=roughness, B=0 (metallic=0).
 * roughness = 1 - glossinessFactor * glossinessAlpha
 * @param {Uint8Array|Buffer} sgBuffer - specularGlossiness image data
 * @param {number} glossinessFactor - glossiness scalar factor
 * @returns {Promise<Buffer>} PNG-encoded metallicRoughness image
 */
async function generateMetallicRoughnessTexture(sgBuffer, glossinessFactor) {
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
    out[px + 0] = 0; // R: unused
    out[px + 1] = Math.round(Math.max(0, Math.min(1, roughness)) * 255); // G: roughness
    out[px + 2] = 0; // B: metallic = 0
    out[px + 3] = 255; // A: opaque
  }

  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * Convert all KHR_materials_pbrSpecularGlossiness materials to
 * standard metallicRoughness + KHR_materials_specular.
 *
 * @param {import('@gltf-transform/core').Document} doc
 * @returns {Promise<{ converted: number, texturesGenerated: number }>}
 */
export async function convertSpecGlossToMetalRough(doc) {
  const {
    KHRMaterialsPBRSpecularGlossiness,
    KHRMaterialsSpecular,
  } = await import("@gltf-transform/extensions");

  const root = doc.getRoot();
  const materials = root.listMaterials();

  // Ensure the specular extension is available
  const specExt = doc.createExtension(KHRMaterialsSpecular);

  let converted = 0;
  let texturesGenerated = 0;

  // Cache generated MR textures to reuse when multiple materials share the
  // same specGloss texture + glossinessFactor combination.
  const mrCache = new Map();
  // Track assigned URIs to avoid collisions when the same source texture is
  // used with different glossinessFactor values.
  const usedMRUris = new Map(); // baseMRUri -> count

  for (const mat of materials) {
    const sg = mat.getExtension("KHR_materials_pbrSpecularGlossiness");
    if (!sg) continue;

    // --- Read spec/gloss properties ---
    const diffuseFactor = sg.getDiffuseFactor(); // vec4
    const diffuseTex = sg.getDiffuseTexture();
    const specularFactor = sg.getSpecularFactor(); // vec3
    const glossinessFactor = sg.getGlossinessFactor(); // number
    const sgTex = sg.getSpecularGlossinessTexture();

    // --- Set base metallic-roughness properties ---
    mat.setBaseColorFactor(diffuseFactor);
    if (diffuseTex) {
      mat.setBaseColorTexture(diffuseTex);
    }
    mat.setMetallicFactor(0);

    // --- Handle roughness from glossiness ---
    // glossiness = glossinessFactor * specGlossTexture.alpha
    // roughness  = 1 - glossiness
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
      // Check cache: same source texture + same glossinessFactor → reuse MR texture
      const cacheKey = `${sgTex.getName() || sgTex.getURI()}:${glossinessFactor}`;
      let mrTex = mrCache.get(cacheKey);

      if (!mrTex) {
        // Generate metallicRoughness texture from the specGloss texture's alpha
        const sgImage = sgTex.getImage();
        const mrBuffer = await generateMetallicRoughnessTexture(
          sgImage,
          glossinessFactor,
        );

        mrTex = doc.createTexture();
        mrTex.setImage(mrBuffer);
        mrTex.setMimeType("image/png");

        const sgUri = sgTex.getURI();
        if (sgUri) {
          const dir = path.dirname(sgUri);
          const base = path.basename(sgUri, path.extname(sgUri));
          const baseMRUri = path.join(dir, `${base}_mr.png`).replace(/\\/g, "/");

          // Deduplicate URI if the same source texture is used with different factors
          let mrUri = baseMRUri;
          const count = usedMRUris.get(baseMRUri) || 0;
          if (count > 0) {
            mrUri = path.join(dir, `${base}_mr${count + 1}.png`).replace(/\\/g, "/");
          }
          usedMRUris.set(baseMRUri, count + 1);

          mrTex.setURI(mrUri);
        }

        mrCache.set(cacheKey, mrTex);
        texturesGenerated++;

        console.log(
          `  Generated metallicRoughness texture: ${mrTex.getURI() || "(embedded)"}`,
        );
      }

      mat.setMetallicRoughnessTexture(mrTex);
      mat.setRoughnessFactor(1.0);
    } else {
      // No texture needed — alpha is constant, so use a scalar roughness.
      // roughness = 1 - glossinessFactor * meanAlpha
      mat.setRoughnessFactor(1.0 - glossinessFactor * meanAlpha);
    }

    // --- Set KHR_materials_specular ---
    const specular = specExt.createSpecular();
    specular.setSpecularColorFactor(specularFactor);
    if (sgTex) {
      specular.setSpecularColorTexture(sgTex);
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
