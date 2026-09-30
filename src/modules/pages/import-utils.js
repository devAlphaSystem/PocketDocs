import { MARKDOWN_IMPORT, MAX_CONTENT_LENGTH, MAX_SLUG_LENGTH, MAX_PAGE_TITLE_LENGTH, SLUG_PATTERN } from "../../config/constants.js";
import { ValidationError } from "../../errors/taxonomy.js";

const MARKDOWN_EXTENSION_PATTERN = /\.(?:md|markdown)$/i;
const CONTROL_CHARS_PATTERN = /[\x00-\x1F\x7F]/;

function displayFilename(filename) {
  return (
    String(filename || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .pop() || "Markdown file"
  );
}

function stripMarkdownExtension(filename) {
  return filename.replace(MARKDOWN_EXTENSION_PATTERN, "");
}

function normalizeImportPath(filename) {
  const normalized = String(filename || "").replace(/\\/g, "/");
  const segments = normalized
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new ValidationError(`Invalid Markdown path: ${displayFilename(filename)}.`);
  }

  return segments;
}

function getFilenameStem(filename) {
  const segments = normalizeImportPath(filename);
  const basename = segments.pop() || String(filename || "");
  return stripMarkdownExtension(basename).trim();
}

function cleanTitleText(value) {
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeFilename(filename) {
  const stem = getFilenameStem(filename).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

  if (!stem) return "";
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function humanizePathSegment(segment) {
  const title = stripMarkdownExtension(String(segment || ""))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) return "";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function extractAtxHeading(content) {
  const source = String(content || "");
  const match = source.match(/^(?:\uFEFF)? {0,3}#[ \t]+([^\r\n]+?)[ \t]*#*[ \t]*(?:\r\n|\n|$)/m);
  const title = match ? cleanTitleText(match[1]) : "";

  if (!title) return null;

  return {
    title,
    start: match.index,
    end: match.index + match[0].length,
  };
}

function extractSetextHeading(content) {
  const source = String(content || "");
  const lines = source.split(/(?<=\n)/).slice(0, 80);
  let offset = 0;

  for (let index = 0; index < lines.length - 1; index += 1) {
    const title = cleanTitleText(lines[index].replace(/\r?\n$/, ""));
    const underline = lines[index + 1].replace(/\r?\n$/, "").trim();
    if (title && /^=+\s*$/.test(underline)) {
      return {
        title,
        start: offset,
        end: offset + lines[index].length + lines[index + 1].length,
      };
    }

    offset += lines[index].length;
  }

  return null;
}

function extractMarkdownImportHeading(content) {
  return extractAtxHeading(content) || extractSetextHeading(content);
}

function removeMarkdownImportHeading(content, heading) {
  if (!heading) return content;

  let end = heading.end;
  if (!content.slice(0, heading.start).trim()) {
    const followingBlankLine = content.slice(end).match(/^[ \t]*(?:\r\n|\n)/);
    if (followingBlankLine) {
      end += followingBlankLine[0].length;
    }
  }

  return `${content.slice(0, heading.start)}${content.slice(end)}`;
}

/**
 * Checks whether a candidate filename has a supported Markdown extension.
 *
 * @param {string} filename - Candidate filename or relative path.
 * @returns {boolean} True when the filename ends with `.md` or `.markdown`.
 */
function isMarkdownImportFilename(filename) {
  return MARKDOWN_EXTENSION_PATTERN.test(String(filename || ""));
}

/**
 * Converts a filename or title value into a URL-safe page slug.
 *
 * @param {string} value - Raw value to slugify.
 * @returns {string} URL-safe slug.
 */
function slugifyMarkdownImportValue(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
}

/**
 * Infers a page title from the first Markdown H1, then from the filename.
 *
 * @param {string} filename - Markdown filename.
 * @param {{ title: string } | null} heading - H1 metadata extracted from the Markdown content.
 * @returns {string} Page title.
 * @throws {ValidationError} If a safe title cannot be inferred.
 */
function deriveMarkdownImportTitle(filename, heading) {
  const title = heading?.title || humanizeFilename(filename);
  if (!title) {
    throw new ValidationError(`Could not infer a page title from ${displayFilename(filename)}.`);
  }
  if (title.length > MAX_PAGE_TITLE_LENGTH) {
    throw new ValidationError(`The title inferred from ${displayFilename(filename)} is longer than ${MAX_PAGE_TITLE_LENGTH} characters.`);
  }
  return title;
}

/**
 * Infers a page slug from the filename stem, falling back to the title.
 *
 * @param {string} filename - Markdown filename.
 * @param {string} title - Page title.
 * @returns {string} Page slug.
 * @throws {ValidationError} If a safe slug cannot be inferred.
 */
function deriveMarkdownImportSlug(filename, title) {
  const slug = slugifyMarkdownImportValue(getFilenameStem(filename)) || slugifyMarkdownImportValue(title);
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new ValidationError(`Could not infer a valid slug from ${displayFilename(filename)}.`);
  }
  return slug;
}

/**
 * Converts a directory segment into a safe imported folder page.
 *
 * @param {string} segment - Raw directory path segment.
 * @returns {{ segment: string, title: string, slug: string }} Normalized folder metadata.
 * @throws {ValidationError} If a safe folder title or slug cannot be inferred.
 */
function normalizeMarkdownImportDirectory(segment) {
  const title = humanizePathSegment(segment);
  if (!title) {
    throw new ValidationError("Could not infer a page title from an imported folder.");
  }
  if (title.length > MAX_PAGE_TITLE_LENGTH) {
    throw new ValidationError(`The title inferred from folder ${segment} is longer than ${MAX_PAGE_TITLE_LENGTH} characters.`);
  }

  const slug = slugifyMarkdownImportValue(segment);
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw new ValidationError(`Could not infer a valid slug from folder ${segment}.`);
  }

  return {
    segment,
    title,
    slug,
  };
}

/**
 * Formats slug lists for concise validation and conflict messages.
 *
 * @param {Array<string>} slugs - Candidate slug values.
 * @returns {string} A short display string.
 */
export function formatMarkdownImportSlugList(slugs) {
  const unique = [...new Set(slugs)];
  const visible = unique.slice(0, 5).join(", ");
  return unique.length > 5 ? `${visible}, and ${unique.length - 5} more` : visible;
}

/**
 * Converts PocketBase field errors into the application's validation detail format.
 *
 * @param {Object} data - PocketBase error payload.
 * @param {string} [prefix="files"] - Detail field prefix.
 * @returns {Array<{ field: string, code: string, message: string }>} Validation details.
 */
export function formatMarkdownImportPbErrors(data, prefix = "files") {
  if (!data?.data) {
    return [];
  }
  return Object.entries(data.data).map(([field, err]) => ({
    field: `${prefix}.${field}`,
    code: (err.code || "INVALID").toUpperCase(),
    message: err.message || "Invalid value.",
  }));
}

/**
 * Detects PocketBase unique slug failures that may be returned as validation
 * errors instead of HTTP conflicts.
 *
 * @param {Object} data - PocketBase error payload.
 * @returns {boolean} True when the slug field failed uniqueness.
 */
export function isPocketBaseUniqueSlugError(data) {
  const code = String(data?.data?.slug?.code || "").toLowerCase();
  return code.includes("unique") || code.includes("not_unique");
}

/**
 * Builds an ordered folder/file plan for preserving imported directory paths.
 *
 * @param {Array<{ filename: string, title: string, slug: string, content: string, directories: Array<Object> }>} files - Normalized Markdown files.
 * @returns {{ folders: Array<Object>, files: Array<Object>, duplicateSlugs: Array<string> }} Import hierarchy plan.
 */
export function buildMarkdownImportHierarchy(files) {
  const folderByKey = new Map();
  const slugUsage = new Map();
  const plannedFiles = [];

  function addSlugUse(slug, use) {
    if (!slugUsage.has(slug)) {
      slugUsage.set(slug, []);
    }
    slugUsage.get(slug).push(use);
  }

  for (const file of files) {
    let parentKey = "";

    for (const directory of file.directories || []) {
      const key = parentKey ? `${parentKey}/${directory.slug}` : directory.slug;
      if (!folderByKey.has(key)) {
        folderByKey.set(key, {
          key,
          parentKey,
          title: directory.title,
          slug: directory.slug,
          segment: directory.segment,
        });
        addSlugUse(directory.slug, { type: "folder", key });
      }
      parentKey = key;
    }

    plannedFiles.push({ ...file, parentKey });
    addSlugUse(file.slug, { type: "file", key: file.filename });
  }

  const duplicateSlugs = [];
  for (const [slug, uses] of slugUsage.entries()) {
    if (uses.length > 1) {
      duplicateSlugs.push(slug);
    }
  }

  return {
    folders: [...folderByKey.values()],
    files: plannedFiles,
    duplicateSlugs,
  };
}

/**
 * Normalizes raw Markdown import file payloads into page creation data.
 *
 * @param {Array<{ filename: string, content: string }>} files - Raw import files.
 * @returns {Array<{ filename: string, title: string, slug: string, content: string, directories: Array<Object> }>} Normalized pages.
 * @throws {ValidationError} If any file is invalid.
 */
export function normalizeMarkdownImportFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new ValidationError("Select at least one Markdown file to import.");
  }

  let totalContentLength = 0;

  return files.map((file, index) => {
    const field = `files.${index}`;
    const filename = String(file?.filename || "").trim();
    const content = typeof file?.content === "string" ? file.content : "";

    if (!filename) {
      throw new ValidationError("Markdown filename is required.", [{ field: `${field}.filename`, code: "REQUIRED", message: "Markdown filename is required." }]);
    }
    if (filename.length > 500 || CONTROL_CHARS_PATTERN.test(filename)) {
      throw new ValidationError(`Invalid Markdown filename: ${displayFilename(filename)}.`);
    }
    const pathSegments = normalizeImportPath(filename);
    if (pathSegments.length === 0) {
      throw new ValidationError("Markdown filename is required.", [{ field: `${field}.filename`, code: "REQUIRED", message: "Markdown filename is required." }]);
    }
    if (!isMarkdownImportFilename(filename)) {
      throw new ValidationError(`${displayFilename(filename)} is not a Markdown file.`);
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new ValidationError(`${displayFilename(filename)} is larger than the per-page content limit.`);
    }

    totalContentLength += content.length;
    if (totalContentLength > MARKDOWN_IMPORT.MAX_TOTAL_CONTENT_LENGTH) {
      throw new ValidationError(`Markdown import content is larger than ${MARKDOWN_IMPORT.MAX_TOTAL_CONTENT_LENGTH} characters.`);
    }

    const heading = extractMarkdownImportHeading(content);
    const title = deriveMarkdownImportTitle(filename, heading);
    const slug = deriveMarkdownImportSlug(filename, title);
    const directories = pathSegments.slice(0, -1).map((segment) => normalizeMarkdownImportDirectory(segment));

    return {
      filename: pathSegments.join("/"),
      title,
      slug,
      content: removeMarkdownImportHeading(content, heading),
      directories,
    };
  });
}
