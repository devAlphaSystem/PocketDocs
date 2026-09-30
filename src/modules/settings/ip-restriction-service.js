import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../../lib/logger.js";
import { normalizeIp } from "../../lib/request-ip.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const IP_RESTRICTION_PATH = join(__dirname, "../../../data/ip-restriction.json");

const DEFAULTS = Object.freeze({
  enabled: "disable",
  allowedIps: "127.0.0.1",
});

let cached = null;
let normalizedIpSet = null;

function parseAllowedIps(value) {
  return String(value || "")
    .split(/[\r\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeAllowedIps(value) {
  return parseAllowedIps(value).join("\n");
}

function rebuildIpSet() {
  const config = cached || DEFAULTS;
  if (config.enabled !== "enable" || !config.allowedIps || !config.allowedIps.trim()) {
    normalizedIpSet = null;
    return;
  }
  const list = parseAllowedIps(config.allowedIps);
  if (list.length === 0) {
    normalizedIpSet = null;
    return;
  }
  normalizedIpSet = new Set(list.map((ip) => normalizeIp(ip)).filter(Boolean));
}

/**
 * Loads IP restriction settings from disk into the in-memory cache,
 * creating defaults if the file does not exist.
 *
 * @returns {Promise<Object>} The loaded IP restriction configuration.
 */
export async function loadIpRestriction() {
  try {
    const raw = await readFile(IP_RESTRICTION_PATH, "utf-8");
    cached = {
      ...DEFAULTS,
      ...JSON.parse(raw),
    };
    cached.allowedIps = normalizeAllowedIps(cached.allowedIps);
    rebuildIpSet();
  } catch (err) {
    if (err.code === "ENOENT") {
      await mkdir(dirname(IP_RESTRICTION_PATH), { recursive: true });
      await writeFile(IP_RESTRICTION_PATH, JSON.stringify(DEFAULTS, null, 2));
      cached = { ...DEFAULTS };
      rebuildIpSet();
      logger.info("Created default IP restriction settings");
    } else {
      logger.error("Failed to load IP restriction settings", { error: err.message });
      cached = { ...DEFAULTS };
      rebuildIpSet();
    }
  }
  return cached;
}

/**
 * Returns the current cached IP restriction settings.
 *
 * @returns {Object} The IP restriction configuration with `enabled` and `allowedIps` fields.
 */
export function getIpRestriction() {
  return cached || { ...DEFAULTS };
}

/**
 * Updates IP restriction settings, automatically including the current request
 * IP in the allow-list when enabling restrictions to prevent self-lockout.
 *
 * @param {Object} data - The update data.
 * @param {string} [data.enabled] - Whether to enable or disable restrictions (`"enable"` or `"disable"`).
 * @param {string} [data.allowedIps] - Newline-separated list of allowed IP addresses.
 * @param {string} requestId - The unique request identifier for logging.
 * @param {string} [currentIp] - The current user's IP address for lockout prevention.
 * @returns {Promise<Object>} The updated IP restriction configuration.
 */
export async function updateIpRestriction(data, requestId, currentIp) {
  let ips = normalizeAllowedIps(data.allowedIps ?? getIpRestriction().allowedIps);

  if (data.enabled === "enable" && currentIp) {
    const ipList = parseAllowedIps(ips);
    const normalizedCurrent = normalizeIp(currentIp);
    const alreadyIncluded = ipList.some((entry) => normalizeIp(entry) === normalizedCurrent);
    if (!alreadyIncluded && normalizedCurrent) {
      ips = ips ? `${normalizedCurrent}\n${ips}` : normalizedCurrent;
      logger.info("Auto-included current IP in allowed list to prevent lockout", { requestId, ip: normalizedCurrent });
    }
  }

  const updated = {
    ...getIpRestriction(),
    ...data,
    allowedIps: ips,
  };
  await mkdir(dirname(IP_RESTRICTION_PATH), { recursive: true });
  await writeFile(IP_RESTRICTION_PATH, JSON.stringify(updated, null, 2));
  cached = updated;
  rebuildIpSet();
  logger.info("IP restriction settings updated", { requestId });
  return updated;
}

/**
 * Checks whether a given IP address is allowed under the current restriction rules.
 *
 * @param {string} ip - The IP address to check.
 * @returns {boolean} `true` if the IP is allowed or restrictions are disabled.
 */
export function isIpAllowed(ip) {
  if (!normalizedIpSet) return true;

  const normalizedIp = normalizeIp(ip);
  if (!normalizedIp) return false;

  return normalizedIpSet.has(normalizedIp);
}
