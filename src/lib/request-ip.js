import { isIP } from "node:net";

function getHeaderValue(headers, name) {
  const value = headers?.[name];

  if (Array.isArray(value)) {
    return value.join(",");
  }

  return typeof value === "string" ? value : "";
}

function splitForwardedHeader(value) {
  return String(value || "")
    .split(",")
    .map((entry) => normalizeIp(entry))
    .filter(Boolean);
}

function splitForwardedForHeader(value) {
  return String(value || "")
    .split(",")
    .map((entry) => {
      const match = entry.match(/(?:^|;)\s*for=(?:"?)([^;"]+)/i);
      if (!match) return "";
      return normalizeIp(match[1]);
    })
    .filter(Boolean);
}

function isLoopbackIp(ip) {
  const normalized = normalizeIp(ip);
  return normalized === "127.0.0.1";
}

function isProxyTrusted(req) {
  const trustProxy = typeof req.app?.get === "function" ? req.app.get("trust proxy") : false;
  if (!trustProxy) {
    return false;
  }

  if (trustProxy === true) {
    return true;
  }

  const remoteAddress = normalizeIp(req.socket?.remoteAddress || "");
  const trustProxyFn = typeof req.app?.get === "function" ? req.app.get("trust proxy fn") : null;
  return Boolean(remoteAddress && typeof trustProxyFn === "function" && trustProxyFn(remoteAddress, 0));
}

function getTrustedProxyHeaderIp(req) {
  if (!isProxyTrusted(req)) {
    return "";
  }

  const proxyIps = Array.isArray(req.ips) ? req.ips.map((ip) => normalizeIp(ip)).filter(Boolean) : [];
  const candidates = [proxyIps[0], splitForwardedHeader(getHeaderValue(req.headers, "cf-connecting-ip"))[0], splitForwardedHeader(getHeaderValue(req.headers, "x-real-ip"))[0], splitForwardedForHeader(getHeaderValue(req.headers, "forwarded"))[0]];

  return candidates.find(Boolean) || "";
}

/**
 * Normalizes an IP address by stripping ports, converting IPv6-mapped IPv4,
 * and resolving loopback addresses.
 *
 * @param {string} ip - The raw IP address string.
 * @returns {string} The normalized IP address, or an empty string if invalid.
 */
export function normalizeIp(ip) {
  const raw = String(ip || "")
    .trim()
    .replace(/^["']|["']$/g, "");

  if (!raw || raw.toLowerCase() === "unknown") {
    return "";
  }

  if (raw === "::1") {
    return "127.0.0.1";
  }

  if (raw.startsWith("::ffff:")) {
    return normalizeIp(raw.slice(7));
  }

  const bracketedIpv6Match = raw.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedIpv6Match) {
    return normalizeIp(bracketedIpv6Match[1]);
  }

  const ipv4WithPortMatch = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
  if (ipv4WithPortMatch) {
    return isIP(ipv4WithPortMatch[1]) ? ipv4WithPortMatch[1] : "";
  }

  return isIP(raw) ? raw : "";
}

/**
 * Extracts and normalizes the client IP address from an Express request.
 *
 * @param {import("express").Request} req - The Express request object.
 * @returns {string} The normalized client IP address.
 */
export function getClientIp(req) {
  const expressIp = normalizeIp(req.ip || "");
  if (expressIp && !isLoopbackIp(expressIp)) {
    return expressIp;
  }

  return getTrustedProxyHeaderIp(req) || expressIp || normalizeIp(req.socket?.remoteAddress || "");
}

/**
 * Returns a detailed breakdown of all IP-related data for debugging proxy
 * and forwarding configurations.
 *
 * @param {import("express").Request} req - The Express request object.
 * @returns {{ clientIp: string, proxyIps: Array<string>, trustedProxyHeaderIp: string, remoteAddress: string, xForwardedFor: Array<string>, xRealIp: string, cfConnectingIp: string, forwardedFor: Array<string> }} IP debug information.
 */
export function getClientIpDebug(req) {
  return {
    clientIp: getClientIp(req),
    proxyIps: Array.isArray(req.ips) ? req.ips.map((ip) => normalizeIp(ip)).filter(Boolean) : [],
    trustedProxyHeaderIp: getTrustedProxyHeaderIp(req),
    remoteAddress: normalizeIp(req.socket?.remoteAddress || ""),
    xForwardedFor: splitForwardedHeader(getHeaderValue(req.headers, "x-forwarded-for")),
    xRealIp: normalizeIp(getHeaderValue(req.headers, "x-real-ip")),
    cfConnectingIp: normalizeIp(getHeaderValue(req.headers, "cf-connecting-ip")),
    forwardedFor: splitForwardedForHeader(getHeaderValue(req.headers, "forwarded")),
  };
}
