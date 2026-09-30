import PocketBase from "pocketbase";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { ExternalServiceError, InfrastructureError } from "../errors/taxonomy.js";

/**
 * Escapes a value for safe use inside PocketBase filter expressions.
 *
 * @param {*} value - The value to escape.
 * @returns {string} The escaped string safe for filter interpolation.
 */
export function pbFilterValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function resolvePocketBaseUrl() {
  const runtimeUrl = process.env.POCKETBASE_URL && process.env.POCKETBASE_URL.trim() !== "" ? process.env.POCKETBASE_URL.trim() : "";
  return runtimeUrl || env.POCKETBASE_URL || "http://127.0.0.1:8090";
}

let pb = null;
let pbUrl = "";

function getPb() {
  const url = resolvePocketBaseUrl();
  if (!pb || pbUrl !== url) {
    pb = new PocketBase(url);
    pb.autoCancellation(false);
    pbUrl = url;
  }
  return pb;
}

/**
 * Returns the shared admin PocketBase client instance.
 *
 * @returns {import("pocketbase").default}
 */
export function pbClient() {
  return getPb();
}

function wrapPbError(err, operation) {
  if (err.status) {
    return new ExternalServiceError(`PocketBase error during ${operation}: ${err.status}`, {
      cause: err,
    });
  }
  if (err.message?.includes("ETIMEDOUT") || err.message?.includes("timeout")) {
    return new InfrastructureError(`PocketBase timeout during ${operation}: ${err.message}`, {
      cause: err,
    });
  }
  if (err.message?.includes("ECONNREFUSED") || err.message?.includes("ECONNRESET")) {
    return new InfrastructureError(`PocketBase connection failed during ${operation}: ${err.message}`, {
      cause: err,
    });
  }
  return new InfrastructureError(`Unexpected error during ${operation}: ${err.message}`, {
    cause: err,
  });
}

async function ensureAdminAuth() {
  const client = getPb();
  if (!client.authStore.isValid) {
    await authenticateAdmin();
  }
}

/**
 * Authenticates as the PocketBase superuser and caches the admin token.
 *
 * @returns {Promise<string>} Resolves with the admin auth token.
 * @throws {ExternalServiceError} If the admin authentication fails.
 */
export async function authenticateAdmin() {
  try {
    const result = await getPb().collection("_superusers").authWithPassword(env.POCKETBASE_ADMIN_EMAIL, env.POCKETBASE_ADMIN_PASSWORD);
    logger.info("PocketBase admin authentication successful");
    return result.token;
  } catch (err) {
    throw new ExternalServiceError(`PocketBase admin auth failed: ${err.message}`, { cause: err });
  }
}

/**
 * Authenticates a user with email and password against a PocketBase collection.
 *
 * @param {string} collection - The PocketBase collection name.
 * @param {string} identity - The user's email or username.
 * @param {string} password - The user's password.
 * @returns {Promise<{ ok: boolean, status: number, data: Object }>} Result envelope with token and record on success.
 * @throws {InfrastructureError} If a network or connection error occurs.
 */
export async function pbAuthWithPassword(collection, identity, password) {
  const client = new PocketBase(resolvePocketBaseUrl());
  client.autoCancellation(false);
  try {
    const result = await client.collection(collection).authWithPassword(identity, password);
    return { ok: true, status: 200, data: { token: result.token, record: result.record } };
  } catch (err) {
    if (err.status) {
      return { ok: false, status: err.status, data: err.data };
    }
    throw wrapPbError(err, `authWithPassword:${collection}`);
  }
}

/**
 * Retrieves a paginated list of records from a PocketBase collection.
 *
 * @param {string} collection - The PocketBase collection name.
 * @param {Object} [params] - Query parameters.
 * @param {number} [params.page=1] - The 1-based page number.
 * @param {number} [params.perPage=30] - Number of records per page.
 * @param {string} [params.sort] - Sort expression.
 * @param {string} [params.filter] - Filter expression.
 * @param {string} [params.expand] - Relations to expand.
 * @param {string} [params.fields] - Fields to select.
 * @returns {Promise<Object>} Paginated result with `items`, `page`, `totalPages`, and `totalItems`.
 * @throws {InfrastructureError|ExternalServiceError} If the query fails.
 */
export async function pbList(collection, params = {}) {
  await ensureAdminAuth();
  const start = Date.now();
  try {
    const result = await getPb()
      .collection(collection)
      .getList(params.page || 1, params.perPage || 30, {
        sort: params.sort,
        filter: params.filter,
        expand: params.expand,
        fields: params.fields,
      });
    logger.debug("PocketBase query completed", { operation: "list", collection, duration_ms: Date.now() - start });
    return result;
  } catch (err) {
    logger.debug("PocketBase query failed", { operation: "list", collection, duration_ms: Date.now() - start });
    throw wrapPbError(err, `list:${collection}`);
  }
}

/**
 * Retrieves a single record by ID from a PocketBase collection.
 *
 * @param {string} collection - The PocketBase collection name.
 * @param {string} id - The record ID.
 * @param {Object} [params] - Query parameters.
 * @param {string} [params.expand] - Relations to expand.
 * @param {string} [params.fields] - Fields to select.
 * @returns {Promise<Object|null>} The record object, or `null` if not found.
 * @throws {InfrastructureError|ExternalServiceError} If the query fails for reasons other than 404.
 */
export async function pbGetOne(collection, id, params = {}) {
  await ensureAdminAuth();
  const start = Date.now();
  try {
    const result = await getPb().collection(collection).getOne(id, {
      expand: params.expand,
      fields: params.fields,
    });
    logger.debug("PocketBase query completed", { operation: "getOne", collection, duration_ms: Date.now() - start });
    return result;
  } catch (err) {
    if (err.status === 404) return null;
    logger.debug("PocketBase query failed", { operation: "getOne", collection, duration_ms: Date.now() - start });
    throw wrapPbError(err, `getOne:${collection}:${id}`);
  }
}

/**
 * Retrieves the first record matching a filter from a PocketBase collection.
 *
 * @param {string} collection - The PocketBase collection name.
 * @param {string} filter - PocketBase filter expression.
 * @param {Object} [params] - Query parameters.
 * @param {string} [params.expand] - Relations to expand.
 * @param {string} [params.fields] - Fields to select.
 * @returns {Promise<Object|null>} The matching record, or `null` if none found.
 * @throws {InfrastructureError|ExternalServiceError} If the query fails for reasons other than 404.
 */
export async function pbGetFirstByFilter(collection, filter, params = {}) {
  await ensureAdminAuth();
  const start = Date.now();
  try {
    const result = await getPb().collection(collection).getFirstListItem(filter, {
      expand: params.expand,
      fields: params.fields,
    });
    logger.debug("PocketBase query completed", { operation: "getFirstByFilter", collection, duration_ms: Date.now() - start });
    return result;
  } catch (err) {
    if (err.status === 404) return null;
    logger.debug("PocketBase query failed", { operation: "getFirstByFilter", collection, duration_ms: Date.now() - start });
    throw wrapPbError(err, `getFirstByFilter:${collection}`);
  }
}

/**
 * Creates a new record in a PocketBase collection.
 *
 * @param {string} collection - The PocketBase collection name.
 * @param {Object} data - The record data to create.
 * @returns {Promise<{ ok: boolean, status: number, data: Object }>} Result envelope with the created record on success.
 * @throws {InfrastructureError} If a non-HTTP error occurs.
 */
export async function pbCreate(collection, data) {
  await ensureAdminAuth();
  const start = Date.now();
  try {
    const record = await getPb().collection(collection).create(data);
    logger.debug("PocketBase write completed", { operation: "create", collection, duration_ms: Date.now() - start });
    return { ok: true, status: 200, data: record };
  } catch (err) {
    logger.debug("PocketBase write failed", { operation: "create", collection, duration_ms: Date.now() - start });
    if (err.status) {
      return { ok: false, status: err.status, data: err.data };
    }
    throw wrapPbError(err, `create:${collection}`);
  }
}

/**
 * Updates an existing record in a PocketBase collection.
 *
 * @param {string} collection - The PocketBase collection name.
 * @param {string} id - The record ID to update.
 * @param {Object} data - The fields to update.
 * @returns {Promise<{ ok: boolean, status: number, data: Object }>} Result envelope with the updated record on success.
 * @throws {InfrastructureError} If a non-HTTP error occurs.
 */
export async function pbUpdate(collection, id, data) {
  await ensureAdminAuth();
  const start = Date.now();
  try {
    const record = await getPb().collection(collection).update(id, data);
    logger.debug("PocketBase write completed", { operation: "update", collection, duration_ms: Date.now() - start });
    return { ok: true, status: 200, data: record };
  } catch (err) {
    logger.debug("PocketBase write failed", { operation: "update", collection, duration_ms: Date.now() - start });
    if (err.status) {
      return { ok: false, status: err.status, data: err.data };
    }
    throw wrapPbError(err, `update:${collection}:${id}`);
  }
}

/**
 * Deletes a record from a PocketBase collection.
 *
 * @param {string} collection - The PocketBase collection name.
 * @param {string} id - The record ID to delete.
 * @returns {Promise<{ ok: boolean, status: number }>} Result envelope confirming deletion.
 * @throws {InfrastructureError} If a non-HTTP error occurs.
 */
export async function pbDelete(collection, id) {
  await ensureAdminAuth();
  const start = Date.now();
  try {
    await getPb().collection(collection).delete(id);
    logger.debug("PocketBase write completed", { operation: "delete", collection, duration_ms: Date.now() - start });
    return { ok: true, status: 204 };
  } catch (err) {
    logger.debug("PocketBase write failed", { operation: "delete", collection, duration_ms: Date.now() - start });
    if (err.status) {
      return { ok: false, status: err.status };
    }
    throw wrapPbError(err, `delete:${collection}:${id}`);
  }
}

/**
 * Executes record updates and deletions in a transactional PocketBase batch.
 *
 * @param {Array<{ method: "update"|"delete", collection: string, id: string, data?: Object }>} operations - Ordered write operations.
 * @returns {Promise<{ ok: boolean, status: number, data: Array<Object>|Object }>} Batch result envelope.
 * @throws {InfrastructureError|TypeError} If the batch cannot be sent or an operation is invalid.
 */
export async function pbBatch(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new TypeError("PocketBase batch requires at least one operation.");
  }

  for (const operation of operations) {
    if (!operation?.collection || !operation.id || !["update", "delete"].includes(operation.method)) {
      throw new TypeError("Invalid PocketBase batch operation.");
    }
  }

  await ensureAdminAuth();
  const start = Date.now();
  const batch = getPb().createBatch();

  for (const operation of operations) {
    const collection = batch.collection(operation.collection);
    if (operation.method === "update") {
      collection.update(operation.id, operation.data || {});
    } else {
      collection.delete(operation.id);
    }
  }

  try {
    const results = await batch.send();
    const failed = results.find((result) => result.status >= 400);
    logger.debug("PocketBase batch completed", { operation: "batch", operationCount: operations.length, duration_ms: Date.now() - start });

    if (failed) {
      return { ok: false, status: failed.status, data: failed.body };
    }

    return { ok: true, status: 200, data: results };
  } catch (err) {
    logger.debug("PocketBase batch failed", { operation: "batch", operationCount: operations.length, duration_ms: Date.now() - start });
    if (err.status) {
      return { ok: false, status: err.status, data: err.data };
    }
    throw wrapPbError(err, "batch");
  }
}

/**
 * Refreshes a user authentication token via PocketBase.
 *
 * @param {string} token - The existing auth token to refresh.
 * @returns {Promise<{ token: string, record: Object }|null>} Updated token and user record, or `null` if refresh fails.
 */
export async function pbAuthRefresh(token) {
  const client = new PocketBase(resolvePocketBaseUrl());
  client.autoCancellation(false);
  client.authStore.save(token);
  try {
    const result = await client.collection("users").authRefresh();
    return { token: result.token, record: result.record };
  } catch {
    return null;
  }
}
