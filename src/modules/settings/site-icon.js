const SITE_ICON_MAX_BYTES = 256 * 1024;
const SITE_ICON_DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|webp)|image\/svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/;
const SVG_ROOT_PATTERN = /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i;
const SVG_FORBIDDEN_TAG_PATTERN = /<\s*\/?\s*(?:[a-z0-9_-]+:)?(?:script|foreignobject|iframe|object|embed|audio|video|image|use|a|style|set|animate|animatemotion|animatetransform|feimage)\b/i;
const SVG_FORBIDDEN_ATTRIBUTE_PATTERN = /\s(?:on[a-z0-9_-]+|(?:xlink:)?href|src|style)\s*=/i;

function hasValidPngSignature(bytes) {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function hasValidJpegSignature(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasValidWebpSignature(bytes) {
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

/**
 * Checks whether SVG source is suitable for same-origin image delivery.
 * Active content, embedded HTML and external resources are not accepted.
 *
 * @param {Buffer} bytes - UTF-8 SVG source.
 * @returns {boolean}
 */
export function isSafeSvg(bytes) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "")
      .trim();
  } catch {
    return false;
  }

  if (!SVG_ROOT_PATTERN.test(source) || (!/<\/svg>\s*$/i.test(source) && !/\/>\s*$/.test(source))) {
    return false;
  }

  if (/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i.test(source)) {
    return false;
  }

  if (SVG_FORBIDDEN_TAG_PATTERN.test(source) || SVG_FORBIDDEN_ATTRIBUTE_PATTERN.test(source)) {
    return false;
  }

  for (const match of source.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    if (!match[2].trim().startsWith("#")) {
      return false;
    }
  }

  return true;
}

/**
 * Decodes and validates an uploaded site icon data URL.
 *
 * @param {string} value - Base64 image data URL.
 * @returns {{ bytes: Buffer, mimeType: string, extension: string }|null}
 */
export function parseSiteIconDataUrl(value) {
  const match = SITE_ICON_DATA_URL_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const mimeType = match[1];
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > SITE_ICON_MAX_BYTES) {
    return null;
  }

  if (mimeType === "image/png" && hasValidPngSignature(bytes)) {
    return { bytes, mimeType, extension: "png" };
  }
  if (mimeType === "image/jpeg" && hasValidJpegSignature(bytes)) {
    return { bytes, mimeType, extension: "jpg" };
  }
  if (mimeType === "image/webp" && hasValidWebpSignature(bytes)) {
    return { bytes, mimeType, extension: "webp" };
  }
  if (mimeType === "image/svg+xml" && isSafeSvg(bytes)) {
    return { bytes, mimeType, extension: "svg" };
  }

  return null;
}
