import { pbList, pbGetOne, pbGetFirstByFilter, pbCreate, pbUpdate, pbDelete, pbFilterValue } from "../../lib/pocketbase.js";
import { COLLECTIONS, PAGINATION, MAX_LABEL_LENGTH } from "../../config/constants.js";
import { NotFoundError, ConflictError, ValidationError } from "../../errors/taxonomy.js";
import { logger } from "../../lib/logger.js";
import { clonePages } from "../pages/service.js";

function generateSlug(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

const LABEL_SUGGESTION_LIMIT = 5;

function normalizeLabel(label) {
  return String(label || "").trim();
}

function padNumber(value, width) {
  return String(value).padStart(width, "0");
}

function isValidSuggestion(label, existingLabels, existingSlugs) {
  const normalized = normalizeLabel(label);
  if (!normalized || normalized.length > MAX_LABEL_LENGTH) return false;
  if (existingLabels.has(normalized.toLowerCase())) return false;

  const slug = generateSlug(normalized);
  return slug && !existingSlugs.has(slug);
}

function addSuggestion(candidates, label) {
  const normalized = normalizeLabel(label);
  if (!normalized) return;
  if (candidates.some((candidate) => candidate.toLowerCase() === normalized.toLowerCase())) return;
  candidates.push(normalized);
}

function formatSemanticVersion(prefix, major, minor, patch, includePatch) {
  const core = includePatch ? `${major}.${minor}.${patch}` : `${major}.${minor}`;
  return `${prefix || ""}${core}`;
}

function formatCurrentQuarterLabel(referenceDate) {
  return `Q${Math.floor(referenceDate.getMonth() / 3) + 1}`;
}

function parsePrerelease(value) {
  const normalized = normalizeLabel(value).toLowerCase();
  const match = normalized.match(/^(alpha|beta|rc|preview|canary)(?:([.-]?)(\d+))?$/);
  if (!match) return null;

  return {
    stage: match[1],
    separator: typeof match[2] === "string" ? match[2] : "",
    number: match[3] ? Number(match[3]) : null,
  };
}

function formatPrerelease(base, stage, number = null, separator = "") {
  if (number === null || typeof number === "undefined") {
    return `${base}-${stage}`;
  }
  return `${base}-${stage}${separator}${number}`;
}

function suggestFromSemanticLabel(label, referenceDate = new Date()) {
  const match = label.match(/^([vV]?)(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return [];

  const prefix = match[1] || "";
  const major = Number(match[2]);
  const minor = Number(match[3]);
  const hasPatch = typeof match[4] !== "undefined";
  const patch = hasPatch ? Number(match[4]) : 0;
  const prerelease = parsePrerelease(match[5]);

  if (!prefix && !hasPatch && major >= 1900) {
    return [];
  }

  const suggestions = [];
  const base = formatSemanticVersion(prefix, major, minor, patch, hasPatch);

  if (prerelease) {
    if (Number.isInteger(prerelease.number)) {
      addSuggestion(suggestions, formatPrerelease(base, prerelease.stage, prerelease.number + 1, prerelease.separator));
    }

    if (prerelease.stage === "alpha" || prerelease.stage === "preview" || prerelease.stage === "canary") {
      addSuggestion(suggestions, formatPrerelease(base, "beta"));
      addSuggestion(suggestions, formatPrerelease(base, "rc", 1));
    } else if (prerelease.stage === "beta") {
      addSuggestion(suggestions, formatPrerelease(base, "rc", 1));
    }

    addSuggestion(suggestions, base);
    return suggestions;
  }

  const nextMinor = formatSemanticVersion(prefix, major, minor + 1, 0, hasPatch);
  const nextPatch = hasPatch ? formatSemanticVersion(prefix, major, minor, patch + 1, true) : formatSemanticVersion(prefix, major, minor, 1, true);
  const nextMajor = formatSemanticVersion(prefix, major + 1, 0, 0, hasPatch);

  addSuggestion(suggestions, nextMinor);
  addSuggestion(suggestions, formatPrerelease(nextMinor, "beta"));
  addSuggestion(suggestions, formatPrerelease(nextMinor, "rc", 1));
  addSuggestion(suggestions, nextPatch);
  addSuggestion(suggestions, nextMajor);
  addSuggestion(suggestions, formatPrerelease(nextPatch, "rc", 1));
  addSuggestion(suggestions, `${nextMinor}-${formatCurrentQuarterLabel(referenceDate)}`);

  return suggestions;
}

function suggestFromCalendarLabel(label) {
  const suggestions = [];

  const quarterMatch = label.match(/^(.*?)(\d{4})([\s._-]?)([Qq])([1-4])(.*?)$/);
  if (quarterMatch) {
    const year = Number(quarterMatch[2]);
    const quarter = Number(quarterMatch[5]);
    for (let step = 1; step <= LABEL_SUGGESTION_LIMIT; step += 1) {
      const totalQuarter = year * 4 + (quarter - 1) + step;
      const nextYear = Math.floor(totalQuarter / 4);
      const nextQuarter = (totalQuarter % 4) + 1;
      addSuggestion(suggestions, `${quarterMatch[1]}${nextYear}${quarterMatch[3]}${quarterMatch[4]}${nextQuarter}${quarterMatch[6]}`);
    }
    return suggestions;
  }

  const monthMatch = label.match(/^(.*?)(\d{4})([-/])(\d{1,2})(.*?)$/) || label.match(/^(.*?)(\d{4})(\.)(\d{2})(.*?)$/);
  if (monthMatch) {
    const year = Number(monthMatch[2]);
    const month = Number(monthMatch[4]);
    if (month >= 1 && month <= 12) {
      for (let step = 1; step <= LABEL_SUGGESTION_LIMIT; step += 1) {
        const totalMonth = year * 12 + (month - 1) + step;
        const nextYear = Math.floor(totalMonth / 12);
        const nextMonth = (totalMonth % 12) + 1;
        addSuggestion(suggestions, `${monthMatch[1]}${nextYear}${monthMatch[3]}${padNumber(nextMonth, monthMatch[4].length)}${monthMatch[5]}`);
      }
      return suggestions;
    }
  }

  const periodMatch = label.match(/^(.*?)(\d{4})(\.)([1-9]\d?)(.*?)$/);
  if (periodMatch) {
    const year = Number(periodMatch[2]);
    const period = Number(periodMatch[4]);
    for (let step = 1; step <= LABEL_SUGGESTION_LIMIT; step += 1) {
      const totalPeriod = year * 12 + (period - 1) + step;
      const nextYear = Math.floor(totalPeriod / 12);
      const nextPeriod = (totalPeriod % 12) + 1;
      addSuggestion(suggestions, `${periodMatch[1]}${nextYear}${periodMatch[3]}${nextPeriod}${periodMatch[5]}`);
    }
    return suggestions;
  }

  const yearMatch = label.match(/^(.*?)(\d{4})(.*?)$/);
  if (yearMatch) {
    for (let step = 1; step <= LABEL_SUGGESTION_LIMIT; step += 1) {
      addSuggestion(suggestions, `${yearMatch[1]}${Number(yearMatch[2]) + step}${yearMatch[3]}`);
    }
  }

  return suggestions;
}

function suggestFromNamedReleaseLabel(label) {
  const match = label.match(/^(.*?)(alpha|beta|rc|release candidate|preview|stable)(?:\s+(\d+))?$/i);
  if (!match) return [];

  const prefix = match[1] || "";
  const stage = match[2].toLowerCase();
  const number = match[3] ? Number(match[3]) : null;
  const suggestions = [];

  if (Number.isInteger(number)) {
    for (let step = 1; step <= 2; step += 1) {
      addSuggestion(suggestions, `${prefix}${match[2]} ${number + step}`);
    }
  }

  if (stage === "alpha" || stage === "preview") {
    addSuggestion(suggestions, `${prefix}Beta`);
    addSuggestion(suggestions, `${prefix}Beta 2`);
    addSuggestion(suggestions, `${prefix}Release Candidate`);
    addSuggestion(suggestions, `${prefix}Release Candidate 2`);
  } else if (stage === "beta") {
    addSuggestion(suggestions, `${prefix}Release Candidate`);
    addSuggestion(suggestions, `${prefix}Release Candidate 2`);
    addSuggestion(suggestions, `${prefix}Stable`);
  } else if (stage === "rc" || stage === "release candidate") {
    addSuggestion(suggestions, `${prefix}Stable`);
    addSuggestion(suggestions, `${prefix}Next`);
  }

  return suggestions;
}

function suggestFromTrailingNumber(label) {
  const match = label.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return [];

  const suggestions = [];
  for (let step = 1; step <= LABEL_SUGGESTION_LIMIT; step += 1) {
    const nextNumber = Number(match[2]) + step;
    addSuggestion(suggestions, `${match[1]}${padNumber(nextNumber, match[2].length)}${match[3]}`);
  }
  return suggestions;
}

function formatCurrentPeriodLabel(referenceDate) {
  return `${referenceDate.getFullYear()}.${referenceDate.getMonth() + 1}`;
}

/**
 * Builds up to five label suggestions from the latest existing version label.
 *
 * @param {Array<{label?: string}>} existingVersions - Existing version records ordered newest first.
 * @param {Date} [referenceDate=new Date()] - Date used only for fallback calendar labels.
 * @returns {string[]} Suggested labels that do not collide with existing labels or generated slugs.
 */
export function suggestVersionLabels(existingVersions = [], referenceDate = new Date()) {
  const labels = existingVersions.map((version) => normalizeLabel(version?.label)).filter(Boolean);
  const existingLabels = new Set(labels.map((label) => label.toLowerCase()));
  const existingSlugs = new Set(labels.map(generateSlug).filter(Boolean));
  const candidates = [];

  for (const label of labels) {
    const labelCandidates = [];

    suggestFromSemanticLabel(label, referenceDate).forEach((suggestion) => addSuggestion(labelCandidates, suggestion));
    if (labelCandidates.length === 0) {
      suggestFromCalendarLabel(label).forEach((suggestion) => addSuggestion(labelCandidates, suggestion));
    }
    if (labelCandidates.length === 0) {
      suggestFromNamedReleaseLabel(label).forEach((suggestion) => addSuggestion(labelCandidates, suggestion));
    }
    if (labelCandidates.length === 0) {
      suggestFromTrailingNumber(label).forEach((suggestion) => addSuggestion(labelCandidates, suggestion));
    }

    labelCandidates.forEach((suggestion) => addSuggestion(candidates, suggestion));

    if (labelCandidates.length > 0 || candidates.length >= LABEL_SUGGESTION_LIMIT) {
      break;
    }
  }

  const suggestions = candidates.filter((label) => isValidSuggestion(label, existingLabels, existingSlugs)).slice(0, LABEL_SUGGESTION_LIMIT);
  if (suggestions.length > 0) {
    return suggestions;
  }

  const fallbackCandidates = [];
  addSuggestion(fallbackCandidates, "v1.0.0");
  addSuggestion(fallbackCandidates, formatCurrentPeriodLabel(referenceDate));
  addSuggestion(fallbackCandidates, "Initial Release");
  addSuggestion(fallbackCandidates, "Next");

  return fallbackCandidates.filter((label) => isValidSuggestion(label, existingLabels, existingSlugs)).slice(0, LABEL_SUGGESTION_LIMIT);
}

/**
 * Retrieves all versions belonging to a project, sorted by descending order.
 *
 * @param {string} projectId - The project record ID.
 * @returns {Promise<Object>} Paginated result containing version items.
 */
export async function listVersions(projectId) {
  return pbList(COLLECTIONS.VERSIONS, {
    filter: `project = "${pbFilterValue(projectId)}"`,
    sort: "-order,-created",
    perPage: 200,
  });
}

/**
 * Retrieves a paginated list of versions for a project with optional search.
 *
 * @param {string} projectId - The project record ID.
 * @param {number} [page=1] - The 1-based page number.
 * @param {string} [search=""] - Optional search term to filter by label or slug.
 * @returns {Promise<Object>} Paginated result containing version items.
 */
export async function listVersionsPaginated(projectId, page = PAGINATION.DEFAULT_PAGE, search = "") {
  let filter = `project = "${pbFilterValue(projectId)}"`;
  if (search) {
    filter += ` && (label ~ "${pbFilterValue(search)}" || slug ~ "${pbFilterValue(search)}")`;
  }
  return pbList(COLLECTIONS.VERSIONS, {
    filter,
    sort: "-order,-created",
    page,
    perPage: PAGINATION.DEFAULT_PER_PAGE,
  });
}

/**
 * Retrieves a single version by its ID with the project relation expanded.
 *
 * @param {string} versionId - The version record ID.
 * @returns {Promise<Object>} The version record with expanded project.
 * @throws {NotFoundError} If the version does not exist.
 */
export async function getVersion(versionId) {
  const version = await pbGetOne(COLLECTIONS.VERSIONS, versionId, { expand: "project" });
  if (!version) {
    throw new NotFoundError("Version");
  }
  return version;
}

/**
 * Retrieves a version by its slug within a project.
 *
 * @param {string} projectId - The project record ID.
 * @param {string} slug - The version slug.
 * @returns {Promise<Object|null>} The version record, or `null` if not found.
 */
async function getVersionBySlug(projectId, slug) {
  return pbGetFirstByFilter(COLLECTIONS.VERSIONS, `project = "${pbFilterValue(projectId)}" && slug = "${pbFilterValue(slug)}"`);
}

/**
 * Creates a new version under a project, optionally cloning content from
 * an existing version.
 *
 * @param {string} projectId - The project record ID.
 * @param {Object} data - Version creation data.
 * @param {string} data.label - The version label.
 * @param {boolean} [data.is_public] - Whether the version is publicly visible.
 * @param {string} [data.clone_from] - An existing version ID to clone pages from.
 * @param {string} requestId - The unique request identifier for logging.
 * @returns {Promise<Object>} The created version record.
 * @throws {ConflictError} If a version with the same label already exists.
 * @throws {ValidationError} If the creation fails.
 */
export async function createVersion(projectId, data, requestId) {
  const slug = generateSlug(data.label);

  const [existing, allVersions] = await Promise.all([getVersionBySlug(projectId, slug), listVersions(projectId)]);
  if (existing) {
    throw new ConflictError("A version with this label already exists in this project.");
  }

  const maxOrder = allVersions.items?.reduce((max, v) => Math.max(max, v.order || 0), 0) || 0;

  const result = await pbCreate(COLLECTIONS.VERSIONS, {
    project: projectId,
    label: data.label,
    slug,
    is_public: data.is_public || false,
    order: maxOrder + 1,
  });

  if (!result.ok) {
    throw new ValidationError("Failed to create version.");
  }

  if (data.clone_from) {
    const sourceVersion = await pbGetOne(COLLECTIONS.VERSIONS, data.clone_from);
    if (sourceVersion && sourceVersion.project === projectId) {
      await cloneVersionContent(data.clone_from, result.data.id, requestId);
    }
  }

  logger.info("Version created", { requestId, versionId: result.data.id, projectId });
  return result.data;
}

async function cloneVersionContent(sourceVersionId, targetVersionId, requestId) {
  await clonePages(sourceVersionId, targetVersionId, requestId);

  const sourceChangelog = await pbGetFirstByFilter(COLLECTIONS.CHANGELOGS, `version = "${pbFilterValue(sourceVersionId)}"`);
  if (sourceChangelog) {
    await pbCreate(COLLECTIONS.CHANGELOGS, {
      version: targetVersionId,
      content: "",
    });
  }

  logger.info("Version content cloned", {
    requestId,
    sourceVersionId,
    targetVersionId,
  });
}

/**
 * Updates an existing version, regenerating the slug if the label is changed.
 *
 * @param {string} versionId - The version record ID.
 * @param {Object} data - The fields to update.
 * @param {string} requestId - The unique request identifier for logging.
 * @returns {Promise<Object>} The updated version record.
 * @throws {ConflictError} If the new label generates a slug that collides with another version.
 * @throws {ValidationError} If the update fails.
 */
export async function updateVersion(versionId, data, requestId) {
  const updateData = { ...data };

  if (updateData.label) {
    const version = await getVersion(versionId);
    const slug = generateSlug(updateData.label);
    const existing = await getVersionBySlug(version.project, slug);
    if (existing && existing.id !== versionId) {
      throw new ConflictError("A version with this label already exists.");
    }
    updateData.slug = slug;
  }

  const result = await pbUpdate(COLLECTIONS.VERSIONS, versionId, updateData);
  if (!result.ok) {
    throw new ValidationError("Failed to update version.");
  }

  logger.info("Version updated", { requestId, versionId });
  return result.data;
}

/**
 * Deletes a version by its ID.
 *
 * @param {string} versionId - The version record ID.
 * @param {string} requestId - The unique request identifier for logging.
 * @returns {Promise<void>}
 * @throws {NotFoundError} If the version does not exist.
 */
export async function deleteVersion(versionId, requestId) {
  const result = await pbDelete(COLLECTIONS.VERSIONS, versionId);
  if (!result.ok) {
    throw new NotFoundError("Version");
  }

  logger.info("Version deleted", { requestId, versionId });
}
