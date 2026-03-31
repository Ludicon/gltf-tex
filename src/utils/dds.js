/**
 * Minimal DDS header parser. Handles both legacy DDS and DX10 extended headers.
 * Returns dimensions, mip count, and DXGI/FourCC format info.
 *
 * Reference:
 *   https://learn.microsoft.com/en-us/windows/win32/direct3ddds/dx-graphics-dds-pguide
 */

const DDS_MAGIC = 0x20534444; // "DDS "

// DDS_HEADER.dwFlags
const DDSD_MIPMAPCOUNT = 0x20000;

// DDS_PIXELFORMAT.dwFlags
const DDPF_FOURCC = 0x4;

// FourCC for DX10 extended header
const FOURCC_DX10 = 0x30315844; // "DX10"

// Common legacy FourCC codes
const FOURCC_DXT1 = 0x31545844;
const FOURCC_DXT3 = 0x33545844;
const FOURCC_DXT5 = 0x35545844;
const FOURCC_ATI1 = 0x31495441; // BC4
const FOURCC_ATI2 = 0x32495441; // BC5
const FOURCC_BC4U = 0x55344342;
const FOURCC_BC4S = 0x53344342;
const FOURCC_BC5U = 0x55354342;
const FOURCC_BC5S = 0x53354342;

/**
 * Block size in bytes for a given DXGI format.
 * Returns 0 for unrecognized formats.
 * @param {number} dxgiFormat
 * @returns {number}
 */
function dxgiBlockSize(dxgiFormat) {
  switch (dxgiFormat) {
    // BC1 (DXT1) - 8 bytes per 4x4 block
    case 70: // BC1_TYPELESS
    case 71: // BC1_UNORM
    case 72: // BC1_UNORM_SRGB
      return 8;

    // BC2 (DXT3) - 16 bytes per 4x4 block
    case 73: // BC2_TYPELESS
    case 74: // BC2_UNORM
    case 75: // BC2_UNORM_SRGB
      return 16;

    // BC3 (DXT5) - 16 bytes per 4x4 block
    case 76: // BC3_TYPELESS
    case 77: // BC3_UNORM
    case 78: // BC3_UNORM_SRGB
      return 16;

    // BC4 - 8 bytes per 4x4 block
    case 79: // BC4_TYPELESS
    case 80: // BC4_UNORM
    case 81: // BC4_SNORM
      return 8;

    // BC5 - 16 bytes per 4x4 block
    case 82: // BC5_TYPELESS
    case 83: // BC5_UNORM
    case 84: // BC5_SNORM
      return 16;

    // BC6H - 16 bytes per 4x4 block
    case 94: // BC6H_TYPELESS
    case 95: // BC6H_UF16
    case 96: // BC6H_SF16
      return 16;

    // BC7 - 16 bytes per 4x4 block
    case 97: // BC7_TYPELESS
    case 98: // BC7_UNORM
    case 99: // BC7_UNORM_SRGB
      return 16;

    default:
      return 0;
  }
}

/**
 * Block size in bytes for a legacy FourCC code.
 * @param {number} fourCC
 * @returns {number}
 */
function fourCCBlockSize(fourCC) {
  switch (fourCC) {
    case FOURCC_DXT1:
      return 8;
    case FOURCC_DXT3:
    case FOURCC_DXT5:
      return 16;
    case FOURCC_ATI1:
    case FOURCC_BC4U:
    case FOURCC_BC4S:
      return 8;
    case FOURCC_ATI2:
    case FOURCC_BC5U:
    case FOURCC_BC5S:
      return 16;
    default:
      return 0;
  }
}

/**
 * Parse a DDS file header from a buffer.
 * @param {Uint8Array|Buffer} data - Raw DDS file data
 * @returns {{ width: number, height: number, mipMapCount: number, blockSize: number } | null}
 */
export function parseDDSHeader(data) {
  if (data.length < 128) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const magic = view.getUint32(0, true);
  if (magic !== DDS_MAGIC) return null;

  const flags = view.getUint32(8, true);
  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  let mipMapCount = (flags & DDSD_MIPMAPCOUNT) ? view.getUint32(28, true) : 1;

  // DDS_PIXELFORMAT starts at offset 76
  const pfFlags = view.getUint32(80, true);
  const fourCC = view.getUint32(84, true);

  let blockSize = 0;

  if ((pfFlags & DDPF_FOURCC) && fourCC === FOURCC_DX10) {
    // DX10 extended header starts at offset 128
    if (data.length < 148) return null;
    const dxgiFormat = view.getUint32(128, true);
    blockSize = dxgiBlockSize(dxgiFormat);
  } else if (pfFlags & DDPF_FOURCC) {
    blockSize = fourCCBlockSize(fourCC);
  }

  return { width, height, mipMapCount, blockSize };
}

/**
 * Get dimensions from DDS image data.
 * @param {Uint8Array|Buffer} data - Raw DDS file data
 * @returns {[number, number]} [width, height]
 */
export function getDDSDimensions(data) {
  const header = parseDDSHeader(data);
  return header ? [header.width, header.height] : [0, 0];
}

/**
 * Estimate video memory size for a DDS texture.
 * Uses the file size minus the header as a proxy, since DDS stores GPU-ready data.
 * @param {Uint8Array|Buffer} data - Raw DDS file data
 * @returns {number} Estimated VRAM size in bytes
 */
export function getDDSVideoMemorySize(data) {
  const header = parseDDSHeader(data);
  if (!header) return 0;

  // Header is 128 bytes, plus 20 bytes for DX10 extension if present
  const pfFlags = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(80, true);
  const fourCC = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(84, true);
  const headerSize = ((pfFlags & DDPF_FOURCC) && fourCC === FOURCC_DX10) ? 148 : 128;

  return Math.max(0, data.length - headerSize);
}
