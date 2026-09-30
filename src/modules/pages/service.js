import { pbList, pbGetOne, pbGetFirstByFilter, pbCreate, pbUpdate, pbDelete, pbBatch, pbFilterValue } from "../../lib/pocketbase.js";
import { randomUUID } from "node:crypto";
import { COLLECTIONS, PAGINATION, PAGE_SECTIONS, PAGE_SECTION_LABELS, PAGE_SECTION_ICONS, PAGE_ITEM_TYPES } from "../../config/constants.js";
import { NotFoundError, ConflictError, ValidationError } from "../../errors/taxonomy.js";
import { logger } from "../../lib/logger.js";
import { buildMarkdownImportHierarchy, formatMarkdownImportPbErrors, formatMarkdownImportSlugList, isPocketBaseUniqueSlugError, normalizeMarkdownImportFiles } from "./import-utils.js";

export const PAGE_SECTION_OPTIONS = Object.freeze([
  { value: PAGE_SECTIONS.DOCUMENTS, label: PAGE_SECTION_LABELS[PAGE_SECTIONS.DOCUMENTS], icon: PAGE_SECTION_ICONS[PAGE_SECTIONS.DOCUMENTS], itemLabel: "page", itemLabelPlural: "pages" },
  { value: PAGE_SECTIONS.FAQ, label: PAGE_SECTION_LABELS[PAGE_SECTIONS.FAQ], icon: PAGE_SECTION_ICONS[PAGE_SECTIONS.FAQ], itemLabel: "article", itemLabelPlural: "articles" },
  { value: PAGE_SECTIONS.TROUBLESHOOTING, label: PAGE_SECTION_LABELS[PAGE_SECTIONS.TROUBLESHOOTING], icon: PAGE_SECTION_ICONS[PAGE_SECTIONS.TROUBLESHOOTING], itemLabel: "article", itemLabelPlural: "articles" },
]);

export function isPageSection(section) {
  return Object.values(PAGE_SECTIONS).includes(section);
}

export function isKnowledgeBaseSection(section) {
  return section === PAGE_SECTIONS.FAQ || section === PAGE_SECTIONS.TROUBLESHOOTING;
}

export function assertPageSection(section) {
  if (!isPageSection(section)) {
    throw new NotFoundError("Page section");
  }
  return section;
}

export function getPageSectionLabel(section) {
  return PAGE_SECTION_LABELS[section] || "Pages";
}

export function getPageSectionIcon(section) {
  return PAGE_SECTION_ICONS[section] || PAGE_SECTION_ICONS[PAGE_SECTIONS.DOCUMENTS];
}

export function getPageSectionOption(section) {
  return PAGE_SECTION_OPTIONS.find((option) => option.value === section) || PAGE_SECTION_OPTIONS[0];
}

function getPageItemType(page) {
  return page?.item_type || PAGE_ITEM_TYPES.PAGE;
}

export function isPageContentItem(page) {
  return getPageItemType(page) === PAGE_ITEM_TYPES.PAGE;
}

function isSidebarNavigationItem(page) {
  const itemType = getPageItemType(page);
  return itemType === PAGE_ITEM_TYPES.HEADER || itemType === PAGE_ITEM_TYPES.SEPARATOR;
}

function pageContentFilter() {
  return `(item_type = "" || item_type = "${PAGE_ITEM_TYPES.PAGE}")`;
}

function pageFilter(versionId, section = PAGE_SECTIONS.DOCUMENTS) {
  let filter = `version = "${pbFilterValue(versionId)}"`;
  if (section) {
    filter += ` && section = "${pbFilterValue(assertPageSection(section))}"`;
  }
  return filter;
}

async function rollbackMarkdownImport(createdPages, updatedPageSnapshots, requestId) {
  const failures = [];

  for (const page of [...updatedPageSnapshots].reverse()) {
    try {
      const restored = await pbUpdate(COLLECTIONS.PAGES, page.id, {
        title: page.title,
        content: page.content || "",
        parent: page.parent || "",
        content_updated: page.content_updated,
      });
      if (!restored.ok) {
        failures.push(page.id);
      }
    } catch (err) {
      failures.push(page.id);
      logger.warn("Failed to rollback imported page update", { requestId, pageId: page.id, error: err.message });
    }
  }

  for (const page of [...createdPages].reverse()) {
    try {
      const deleted = await pbDelete(COLLECTIONS.PAGES, page.id);
      if (!deleted.ok) {
        failures.push(page.id);
      }
    } catch (err) {
      failures.push(page.id);
      logger.warn("Failed to rollback imported page", { requestId, pageId: page.id, error: err.message });
    }
  }

  if (failures.length > 0) {
    logger.warn("Markdown import rollback finished with failures", { requestId, failedCount: failures.length });
  }
}

export async function listPages(versionId, section = PAGE_SECTIONS.DOCUMENTS) {
  return pbList(COLLECTIONS.PAGES, {
    filter: pageFilter(versionId, section),
    sort: "order,title",
    perPage: 500,
  });
}

export async function listAllPages(versionId) {
  return pbList(COLLECTIONS.PAGES, {
    filter: `version = "${pbFilterValue(versionId)}"`,
    sort: "section,order,title",
    perPage: 1000,
  });
}

export async function listPagesPaginated(versionId, section = PAGE_SECTIONS.DOCUMENTS, page = PAGINATION.DEFAULT_PAGE, search = "") {
  let filter = pageFilter(versionId, section);
  if (search) {
    filter += ` && ${pageContentFilter()} && (title ~ "${pbFilterValue(search)}" || slug ~ "${pbFilterValue(search)}")`;
  }
  return pbList(COLLECTIONS.PAGES, {
    filter,
    sort: "order,title",
    page,
    perPage: PAGINATION.DEFAULT_PER_PAGE,
  });
}

export function buildPageTree(pages) {
  const map = new Map();
  const roots = [];

  for (const page of pages) {
    map.set(page.id, { ...page, children: [] });
  }

  for (const page of pages) {
    const node = map.get(page.id);
    if (page.parent && map.has(page.parent)) {
      map.get(page.parent).children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export function flattenPageTree(nodes, depth = 0) {
  const items = [];

  for (const node of nodes || []) {
    items.push({ ...node, depth });
    if (node.children && node.children.length > 0) {
      items.push(...flattenPageTree(node.children, depth + 1));
    }
  }

  return items;
}

export async function getPage(pageId) {
  const page = await pbGetOne(COLLECTIONS.PAGES, pageId, { expand: "version" });
  if (!page) {
    throw new NotFoundError("Page");
  }
  return page;
}

async function getPageBySlug(versionId, section, slug) {
  return pbGetFirstByFilter(COLLECTIONS.PAGES, `${pageFilter(versionId, section)} && ${pageContentFilter()} && slug = "${pbFilterValue(slug)}"`);
}

function assertParentAllowedFromPages(pages, parentId, currentPageId = "") {
  if (!parentId) return;

  const pageMap = new Map((pages || []).map((page) => [page.id, page]));
  const parent = pageMap.get(parentId);
  if (!parent || !isPageContentItem(parent)) {
    throw new ValidationError("Parent page must belong to the same section.");
  }

  if (currentPageId && parentId === currentPageId) {
    throw new ValidationError("A page cannot be its own parent.");
  }

  let cursor = parent;
  const seen = new Set();
  while (cursor?.parent) {
    if (cursor.parent === currentPageId) {
      throw new ValidationError("Parent page cannot be a child of this page.");
    }
    if (seen.has(cursor.parent)) {
      throw new ValidationError("Page hierarchy contains a cycle.");
    }
    seen.add(cursor.parent);
    cursor = pageMap.get(cursor.parent);
  }
}

export async function createPage(versionId, data, requestId) {
  const section = assertPageSection(data.section || PAGE_SECTIONS.DOCUMENTS);
  const [existing, allPages] = await Promise.all([getPageBySlug(versionId, section, data.slug), listPages(versionId, section)]);
  if (existing) {
    throw new ConflictError("A page with this slug already exists in this section.");
  }

  const pages = allPages.items || [];
  assertParentAllowedFromPages(pages, data.parent || "");
  const maxOrder = pages.reduce((max, page) => Math.max(max, page.order || 0), 0);

  const result = await pbCreate(COLLECTIONS.PAGES, {
    version: versionId,
    section,
    title: data.title,
    slug: data.slug,
    content: data.content || "",
    content_updated: new Date().toISOString(),
    parent: data.parent || "",
    icon: data.icon || "",
    item_type: PAGE_ITEM_TYPES.PAGE,
    order: maxOrder + 1,
  });

  if (!result.ok) {
    throw new ValidationError("Failed to create page.");
  }

  logger.info("Page created", { requestId, pageId: result.data.id, versionId, section });
  return result.data;
}

export async function importMarkdownPages(versionId, section, files, requestId) {
  const normalizedSection = assertPageSection(section || PAGE_SECTIONS.DOCUMENTS);
  const normalizedFiles = normalizeMarkdownImportFiles(files);
  const importPlan = buildMarkdownImportHierarchy(normalizedFiles);
  const pagesResult = await listPages(versionId, normalizedSection);
  const existingPages = pagesResult.items || [];
  const existingPageBySlug = new Map(existingPages.filter(isPageContentItem).map((page) => [page.slug, page]));

  if (importPlan.duplicateSlugs.length > 0) {
    throw new ValidationError(`Markdown import contains duplicate page slugs: ${formatMarkdownImportSlugList(importPlan.duplicateSlugs)}.`);
  }

  let nextOrder = existingPages.reduce((max, page) => Math.max(max, page.order || 0), 0) + 1;
  const createdPages = [];
  const updatedPageSnapshots = [];
  const importedPages = [];
  const folderIdByKey = new Map();

  try {
    for (const folder of importPlan.folders) {
      const parent = folder.parentKey ? folderIdByKey.get(folder.parentKey) || "" : "";
      const existing = existingPageBySlug.get(folder.slug);

      if (existing) {
        if ((existing.parent || "") !== parent) {
          throw new ConflictError(`Cannot preserve folder hierarchy because the slug ${folder.slug} already exists under another parent.`);
        }
        folderIdByKey.set(folder.key, existing.id);
        continue;
      }

      const result = await pbCreate(COLLECTIONS.PAGES, {
        version: versionId,
        section: normalizedSection,
        title: folder.title,
        slug: folder.slug,
        content: "",
        content_updated: new Date().toISOString(),
        parent,
        icon: "",
        item_type: PAGE_ITEM_TYPES.PAGE,
        order: nextOrder,
      });

      if (!result.ok) {
        const details = formatMarkdownImportPbErrors(result.data);
        if (result.status === 409 || isPocketBaseUniqueSlugError(result.data)) {
          throw new ConflictError("A folder page with one of these slugs already exists.");
        }
        throw new ValidationError("Failed to import Markdown folders.", details);
      }

      nextOrder += 1;
      createdPages.push(result.data);
      importedPages.push(result.data);
      folderIdByKey.set(folder.key, result.data.id);
    }

    for (const file of importPlan.files) {
      const parent = file.parentKey ? folderIdByKey.get(file.parentKey) || "" : "";
      const existing = existingPageBySlug.get(file.slug);

      if (existing) {
        const updateData = {
          title: file.title,
          content: file.content,
        };
        if (file.parentKey) {
          updateData.parent = parent;
        }

        const updatedPage = await updatePage(existing.id, updateData, requestId);

        updatedPageSnapshots.push(existing);
        importedPages.push(updatedPage);
        continue;
      }

      const result = await pbCreate(COLLECTIONS.PAGES, {
        version: versionId,
        section: normalizedSection,
        title: file.title,
        slug: file.slug,
        content: file.content,
        content_updated: new Date().toISOString(),
        parent,
        icon: "",
        item_type: PAGE_ITEM_TYPES.PAGE,
        order: nextOrder,
      });

      if (!result.ok) {
        const details = formatMarkdownImportPbErrors(result.data);
        if (result.status === 409 || isPocketBaseUniqueSlugError(result.data)) {
          throw new ConflictError("A page with one of these slugs already exists.");
        }
        throw new ValidationError("Failed to import Markdown pages.", details);
      }

      nextOrder += 1;
      createdPages.push(result.data);
      importedPages.push(result.data);
    }
  } catch (err) {
    await rollbackMarkdownImport(createdPages, updatedPageSnapshots, requestId);
    throw err;
  }

  logger.info("Markdown pages imported", {
    requestId,
    versionId,
    section: normalizedSection,
    count: importedPages.length,
    createdCount: createdPages.length,
    updatedCount: updatedPageSnapshots.length,
  });
  return {
    pages: importedPages,
    createdCount: createdPages.length,
    updatedCount: updatedPageSnapshots.length,
    updatedPageIds: updatedPageSnapshots.map((page) => page.id),
  };
}

export async function updatePage(pageId, data, requestId) {
  const page = await getPage(pageId);
  if (!isPageContentItem(page)) {
    throw new NotFoundError("Page");
  }
  const updateData = { ...data };
  delete updateData.section;

  if (updateData.slug && updateData.slug !== page.slug) {
    const existing = await getPageBySlug(page.version, page.section, updateData.slug);
    if (existing && existing.id !== pageId) {
      throw new ConflictError("A page with this slug already exists in this section.");
    }
  }

  if (updateData.parent !== undefined) {
    const allPages = await listPages(page.version, page.section);
    assertParentAllowedFromPages(allPages.items || [], updateData.parent || "", pageId);
  }

  if (!Object.entries(updateData).some(([field, value]) => value !== undefined && value !== page[field])) {
    return page;
  }

  if (["title", "slug", "content", "icon"].some((field) => updateData[field] !== undefined && updateData[field] !== page[field])) {
    updateData.content_updated = new Date().toISOString();
  }

  const result = await pbUpdate(COLLECTIONS.PAGES, pageId, updateData);
  if (!result.ok) {
    throw new ValidationError("Failed to update page.");
  }

  logger.info("Page updated", { requestId, pageId, versionId: page.version, section: page.section });
  return result.data;
}

export async function createSidebarNavigationItem(versionId, data, requestId) {
  const itemType = data.itemType;
  if (itemType !== PAGE_ITEM_TYPES.HEADER && itemType !== PAGE_ITEM_TYPES.SEPARATOR) {
    throw new ValidationError("Invalid sidebar item type.");
  }

  const pagesResult = await listPages(versionId, PAGE_SECTIONS.DOCUMENTS);
  const items = pagesResult.items || [];
  const maxOrder = items.reduce((max, item) => Math.max(max, item.order || 0), 0);
  const title = itemType === PAGE_ITEM_TYPES.HEADER ? data.title.trim() : "Separator";
  const collapsedByDefault = itemType === PAGE_ITEM_TYPES.HEADER && data.collapsed_by_default === true;
  const result = await pbCreate(COLLECTIONS.PAGES, {
    version: versionId,
    section: PAGE_SECTIONS.DOCUMENTS,
    item_type: itemType,
    collapsed_by_default: collapsedByDefault,
    title,
    slug: `sidebar-${itemType}-${randomUUID()}`,
    content: "",
    parent: "",
    icon: "",
    order: maxOrder + 1,
  });

  if (!result.ok) {
    throw new ValidationError("Failed to create sidebar item.");
  }

  if (result.data.item_type !== itemType || result.data.collapsed_by_default !== collapsedByDefault) {
    const cleanup = await pbDelete(COLLECTIONS.PAGES, result.data.id);
    if (!cleanup.ok) {
      logger.warn("Failed to remove invalid sidebar item after schema mismatch", { requestId, pageId: result.data.id, versionId, itemType });
    }
    throw new ValidationError("PocketDocs could not persist this sidebar item. Apply the current database schema and try again.");
  }

  logger.info("Sidebar item created", { requestId, pageId: result.data.id, versionId, itemType });
  return result.data;
}

export async function updateSidebarHeader(pageId, data, requestId) {
  const item = await getPage(pageId);
  if (item.section !== PAGE_SECTIONS.DOCUMENTS || getPageItemType(item) !== PAGE_ITEM_TYPES.HEADER) {
    throw new NotFoundError("Sidebar header");
  }

  const result = await pbUpdate(COLLECTIONS.PAGES, pageId, {
    title: data.title,
    collapsed_by_default: data.collapsed_by_default,
  });
  if (!result.ok) {
    throw new ValidationError("Failed to update sidebar header.");
  }

  if (result.data.collapsed_by_default !== data.collapsed_by_default) {
    throw new ValidationError("PocketDocs could not persist the sidebar header default state. Apply the current database schema and try again.");
  }

  logger.info("Sidebar header updated", { requestId, pageId, versionId: item.version });
  return result.data;
}

export async function deleteSidebarNavigationItem(pageId, requestId) {
  const item = await getPage(pageId);
  if (item.section !== PAGE_SECTIONS.DOCUMENTS || !isSidebarNavigationItem(item)) {
    throw new NotFoundError("Sidebar item");
  }

  const result = await pbDelete(COLLECTIONS.PAGES, pageId);
  if (!result.ok) {
    throw new NotFoundError("Sidebar item");
  }

  logger.info("Sidebar item deleted", { requestId, pageId, versionId: item.version, itemType: getPageItemType(item) });
}

export async function deletePage(pageId, requestId) {
  const page = await getPage(pageId);
  if (!isPageContentItem(page)) {
    throw new NotFoundError("Page");
  }

  const children = await pbList(COLLECTIONS.PAGES, {
    filter: `parent = "${pbFilterValue(pageId)}"`,
    perPage: 200,
  });
  await Promise.all((children.items || []).map((child) => pbUpdate(COLLECTIONS.PAGES, child.id, { parent: page.parent || "" })));

  const result = await pbDelete(COLLECTIONS.PAGES, pageId);
  if (!result.ok) {
    throw new NotFoundError("Page");
  }

  logger.info("Page deleted", { requestId, pageId, versionId: page.version, section: page.section });
}

function pageDepth(page, pageMap) {
  let depth = 0;
  let parentId = page.parent || "";
  const seen = new Set([page.id]);

  while (parentId && pageMap.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = pageMap.get(parentId).parent || "";
  }

  return depth;
}

function survivingParentId(page, pageMap, selectedPageIds) {
  let parentId = page.parent || "";
  const seen = new Set([page.id]);

  while (parentId && selectedPageIds.has(parentId)) {
    if (seen.has(parentId)) {
      throw new ValidationError("Page hierarchy contains a cycle.");
    }
    seen.add(parentId);
    parentId = pageMap.get(parentId)?.parent || "";
  }

  return parentId;
}

export async function deletePages(versionId, section, pageIds, requestId) {
  const normalizedSection = assertPageSection(section || PAGE_SECTIONS.DOCUMENTS);
  const uniquePageIds = [...new Set(pageIds || [])];
  const pagesResult = await listPages(versionId, normalizedSection);
  const pageMap = new Map((pagesResult.items || []).map((page) => [page.id, page]));

  if (uniquePageIds.length === 0 || uniquePageIds.some((pageId) => !pageMap.has(pageId))) {
    throw new ValidationError("Selected items must belong to this version and section.");
  }

  const selectedPages = uniquePageIds.map((pageId) => pageMap.get(pageId));
  selectedPages.sort((left, right) => pageDepth(right, pageMap) - pageDepth(left, pageMap));
  const selectedPageIds = new Set(uniquePageIds);
  const reparentOperations = (pagesResult.items || [])
    .filter((page) => !selectedPageIds.has(page.id) && selectedPageIds.has(page.parent))
    .map((page) => ({
      method: "update",
      collection: COLLECTIONS.PAGES,
      id: page.id,
      data: { parent: survivingParentId(page, pageMap, selectedPageIds) },
    }));
  const deleteOperations = selectedPages.map((page) => ({
    method: "delete",
    collection: COLLECTIONS.PAGES,
    id: page.id,
  }));
  const result = await pbBatch([...reparentOperations, ...deleteOperations]);

  if (!result.ok) {
    throw new ValidationError("Failed to remove the selected items.");
  }

  logger.info("Selected items deleted", {
    requestId,
    versionId,
    section: normalizedSection,
    count: selectedPages.length,
    reparentedCount: reparentOperations.length,
  });

  return selectedPages.length;
}

function assertReorderDoesNotCreateCycle(pageMap, pageId, parentId) {
  let cursorId = parentId;
  const seen = new Set([pageId]);

  while (cursorId) {
    if (seen.has(cursorId)) {
      throw new ValidationError("Page hierarchy contains a cycle.");
    }
    seen.add(cursorId);
    cursorId = pageMap.get(cursorId)?.parent || "";
  }
}

export async function reorderPages(versionId, section, updates, requestId) {
  const normalizedSection = assertPageSection(section || PAGE_SECTIONS.DOCUMENTS);
  const pagesResult = await listPages(versionId, normalizedSection);
  const pageMap = new Map((pagesResult.items || []).map((page) => [page.id, page]));
  const proposedPageMap = new Map(pageMap);

  for (const update of updates) {
    if (!pageMap.has(update.id)) {
      throw new ValidationError("Reorder data contains a page outside this section.");
    }
    if (update.parent && !pageMap.has(update.parent)) {
      throw new ValidationError("Parent page must belong to the same section.");
    }
    if (isSidebarNavigationItem(pageMap.get(update.id)) && update.parent) {
      throw new ValidationError("Sidebar headers and separators must remain top-level.");
    }
    if (update.parent && !isPageContentItem(pageMap.get(update.parent))) {
      throw new ValidationError("Parent page must be a document in the same section.");
    }
    proposedPageMap.set(update.id, { ...pageMap.get(update.id), parent: update.parent || "" });
  }

  for (const update of updates) {
    assertReorderDoesNotCreateCycle(proposedPageMap, update.id, update.parent || "");
  }

  const results = await Promise.all(updates.map((update) => pbUpdate(COLLECTIONS.PAGES, update.id, { order: update.order, parent: update.parent || "" })));
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    logger.warn("Some page reorder operations failed", {
      requestId,
      failedCount: failed.length,
      versionId,
      section: normalizedSection,
    });
  }

  logger.info("Pages reordered", { requestId, versionId, section: normalizedSection, count: updates.length });
}

function sortPagesForClone(pages) {
  const sorted = [];
  const remaining = [...pages];
  const processed = new Set();

  for (let i = remaining.length - 1; i >= 0; i -= 1) {
    if (!remaining[i].parent) {
      sorted.push(remaining[i]);
      processed.add(remaining[i].id);
      remaining.splice(i, 1);
    }
  }

  let safety = remaining.length + 1;
  while (remaining.length > 0 && safety > 0) {
    safety -= 1;
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (processed.has(remaining[i].parent)) {
        sorted.push(remaining[i]);
        processed.add(remaining[i].id);
        remaining.splice(i, 1);
      }
    }
  }

  sorted.push(...remaining);
  return sorted;
}

export async function clonePages(sourceVersionId, targetVersionId, requestId) {
  const sourcePagesResult = await listAllPages(sourceVersionId);
  const sourcePages = sortPagesForClone(sourcePagesResult.items || []);
  const idMap = new Map();

  for (const page of sourcePages) {
    const newParent = page.parent ? idMap.get(page.parent) || "" : "";
    const cloned = await pbCreate(COLLECTIONS.PAGES, {
      version: targetVersionId,
      section: page.section || PAGE_SECTIONS.DOCUMENTS,
      title: page.title,
      slug: page.slug,
      content: page.content || "",
      parent: newParent,
      icon: page.icon || "",
      content_updated: page.content_updated,
      item_type: getPageItemType(page),
      collapsed_by_default: page.collapsed_by_default === true,
      order: page.order || 0,
    });
    if (cloned.ok) {
      idMap.set(page.id, cloned.data.id);
    }
  }

  logger.info("Pages cloned", {
    requestId,
    sourceVersionId,
    targetVersionId,
    pagesCloned: idMap.size,
  });
}
