import fs from "node:fs/promises";

/**
 * GLB constants
 */
const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"
const GLB_HEADER_SIZE = 12;
const CHUNK_HEADER_SIZE = 8;

// Max bytes per fs.read call (Node.js limit is 2 GiB - 1, keep well under)
const READ_CHUNK_SIZE = 1024 * 1024 * 512; // 512 MiB

/**
 * Read `length` bytes from a file handle at `position` into a pre-allocated buffer.
 * Handles the case where the read size exceeds Node.js's per-call limit by
 * reading in multiple passes.
 * @param {import('node:fs/promises').FileHandle} handle
 * @param {Buffer} buf
 * @param {number} length
 * @param {number} position
 */
async function readFull(handle, buf, length, position) {
  let bytesRead = 0;
  while (bytesRead < length) {
    const toRead = Math.min(length - bytesRead, READ_CHUNK_SIZE);
    const result = await handle.read(buf, bytesRead, toRead, position + bytesRead);
    if (result.bytesRead === 0) {
      throw new Error("Unexpected end of file");
    }
    bytesRead += result.bytesRead;
  }
}

/**
 * Read a GLB file by streaming its chunks, bypassing Node.js's 2 GiB
 * fs.readFile limit. Returns a JSONDocument suitable for gltf-transform's
 * io.readJSON().
 *
 * @param {string} filePath - Path to the .glb file
 * @returns {Promise<{ json: object, resources: Record<string, Uint8Array> }>}
 */
export async function readGLB(filePath) {
  const handle = await fs.open(filePath, "r");

  try {
    // --- Read 12-byte GLB header ---
    const headerBuf = Buffer.alloc(GLB_HEADER_SIZE);
    await handle.read(headerBuf, 0, GLB_HEADER_SIZE, 0);

    const magic = headerBuf.readUInt32LE(0);
    if (magic !== GLB_MAGIC) {
      throw new Error("Not a valid GLB file");
    }

    const version = headerBuf.readUInt32LE(4);
    if (version !== GLB_VERSION) {
      throw new Error(`Unsupported GLB version: ${version}`);
    }

    const totalLength = headerBuf.readUInt32LE(8);

    // --- Read chunks ---
    let json = null;
    const resources = {};
    let offset = GLB_HEADER_SIZE;

    while (offset < totalLength) {
      // Read chunk header (8 bytes: length + type)
      const chunkHeaderBuf = Buffer.alloc(CHUNK_HEADER_SIZE);
      await handle.read(chunkHeaderBuf, 0, CHUNK_HEADER_SIZE, offset);

      const chunkLength = chunkHeaderBuf.readUInt32LE(0);
      const chunkType = chunkHeaderBuf.readUInt32LE(4);
      const chunkDataOffset = offset + CHUNK_HEADER_SIZE;

      if (chunkType === CHUNK_TYPE_JSON) {
        const jsonBuf = Buffer.alloc(chunkLength);
        await readFull(handle, jsonBuf, chunkLength, chunkDataOffset);
        json = JSON.parse(jsonBuf.toString("utf8"));
      } else if (chunkType === CHUNK_TYPE_BIN) {
        const binBuf = Buffer.alloc(chunkLength);
        await readFull(handle, binBuf, chunkLength, chunkDataOffset);
        // gltf-transform expects the binary buffer keyed as "@glb.bin"
        resources["@glb.bin"] = new Uint8Array(
          binBuf.buffer,
          binBuf.byteOffset,
          binBuf.byteLength,
        );
      }
      // Skip unknown chunk types

      offset = chunkDataOffset + chunkLength;
    }

    if (!json) {
      throw new Error("GLB file has no JSON chunk");
    }

    return { json, resources };
  } finally {
    await handle.close();
  }
}
