/**
 * @module pages/controller
 * @description Express routes for CRUD operations on version content sections.
 */
import { Router } from "express";
import { listPages, listPagesPaginated, buildPageTree, flattenPageTree, getPage, createPage, createSidebarNavigationItem, importMarkdownPages, updatePage, updateSidebarHeader, deletePage, deletePages, deleteSidebarNavigationItem, reorderPages, isPageContentItem, PAGE_SECTION_OPTIONS, isPageSection, assertPageSection, getPageSectionLabel, getPageSectionIcon, getPageSectionOption } from "./service.js";
import { createPageSchema, createSidebarItemSchema, updatePageSchema, updateSidebarHeaderSchema, reorderPagesSchema, deletePagesSchema, importMarkdownPagesSchema } from "./validation.js";
import { requireAuth, requireProjectAccess } from "../../middleware/auth.js";
import { csrfMiddleware } from "../../middleware/csrf.js";
import { getVersion } from "../versions/service.js";
import { ROLES, PROJECT_MODE, PAGE_SECTIONS, PAGE_ITEM_TYPES, MARKDOWN_IMPORT, MAX_TITLE_LENGTH, MAX_PAGE_TITLE_LENGTH } from "../../config/constants.js";
import { env } from "../../config/env.js";
import { NotFoundError } from "../../errors/taxonomy.js";

const router = Router({ mergeParams: true });
const EDITOR_EXTRA_CSS = ["https://cdn.jsdelivr.net/npm/easymde@2.18.0/dist/easymde.min.css", "/css/easymde.css"];
const EDITOR_EXTRA_JS = ["https://cdn.jsdelivr.net/npm/easymde@2.18.0/dist/easymde.min.js", "/js/editor.js"];

router.use(requireAuth);

function isNonVersioned(project) {
  return (project?.mode || PROJECT_MODE.VERSIONED) === PROJECT_MODE.NON_VERSIONED;
}

function userCanManagePages(user) {
  return user?.role === ROLES.OWNER || user?.role === ROLES.ADMIN;
}

function selectedSection(req) {
  const section = req.query.section || req.body?.section || PAGE_SECTIONS.DOCUMENTS;
  return isPageSection(section) ? section : PAGE_SECTIONS.DOCUMENTS;
}

async function getAdminContext(req) {
  const version = await getVersion(req.params.versionId);
  const project = version.expand?.project;
  if (!project) {
    throw new NotFoundError("Project");
  }
  return {
    project,
    version,
    nonVersionedMode: isNonVersioned(project),
  };
}

function pageAdminUrl(projectId, versionId, section, extraParams = {}) {
  const params = new URLSearchParams({ section });
  for (const [key, value] of Object.entries(extraParams)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  }
  return `/admin/projects/${projectId}/versions/${versionId}/pages?${params.toString()}`;
}

function publicSectionUrl(project, version, section) {
  if (section === PAGE_SECTIONS.DOCUMENTS) {
    return isNonVersioned(project) ? `/docs/${project.slug}` : `/docs/${project.slug}/${version.slug}`;
  }
  return isNonVersioned(project) ? `/docs/${project.slug}/_kb/${section}` : `/docs/${project.slug}/${version.slug}/_kb/${section}`;
}

function assertPageBelongsToVersion(page, versionId) {
  if (page.version !== versionId) {
    throw new NotFoundError("Page");
  }
}

function validationDetails(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join("."),
    code: issue.code.toUpperCase(),
    message: issue.message,
  }));
}

function renderEditor(res, req, context, values) {
  const { project, version, nonVersionedMode } = context;
  const section = values.section;
  const sectionOption = getPageSectionOption(section);

  if (!req.xhr) {
    return res.redirect(
      303,
      pageAdminUrl(project.id, version.id, section, {
        error: values.error,
        success: req.query.success,
      }),
    );
  }

  return res.status(values.statusCode || 200).render("admin/pages/editor", {
    title: values.title,
    project,
    version,
    nonVersionedMode,
    section,
    sectionLabel: getPageSectionLabel(section),
    sectionIcon: getPageSectionIcon(section),
    sectionOption,
    page: values.page || null,
    pages: values.pages || [],
    user: req.user,
    csrfToken: res.locals.csrfToken,
    error: values.error || null,
    success: req.query.success || null,
    formValues: values.formValues || null,
    maxTitleLength: MAX_TITLE_LENGTH,
    maxPageTitleLength: MAX_PAGE_TITLE_LENGTH,
    siteName: env.SITE_NAME,
    extraCss: EDITOR_EXTRA_CSS,
    extraJs: EDITOR_EXTRA_JS,
  });
}

async function renderNewItemEditor(res, req, context, section, values = {}) {
  const pagesResult = await listPages(context.version.id, section);
  return renderEditor(res, req, context, {
    title: section === PAGE_SECTIONS.DOCUMENTS ? "New Item" : `New ${getPageSectionLabel(section)} Article`,
    section,
    page: null,
    pages: pagesResult.items || [],
    ...values,
  });
}

router.get("/", csrfMiddleware, requireProjectAccess(), async (req, res, next) => {
  try {
    const section = selectedSection(req);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const search = (req.query.search || "").trim();
    const { project, version, nonVersionedMode } = await getAdminContext(req);
    const pagesResult = await listPagesPaginated(version.id, section, page, search);

    const pages = pagesResult.items || [];
    const pageTree = search ? [] : buildPageTree(pages);
    const pageTreeItems = search ? [] : flattenPageTree(pageTree);
    const sectionLabel = getPageSectionLabel(section);
    const sectionOption = getPageSectionOption(section);
    const isDocumentsSection = section === PAGE_SECTIONS.DOCUMENTS;
    const itemLabel = sectionOption.itemLabel || (isDocumentsSection ? "page" : "article");
    const itemLabelPlural = sectionOption.itemLabelPlural || `${itemLabel}s`;
    const selectionItemLabel = isDocumentsSection ? "sidebar item" : itemLabel;
    const selectionItemLabelPlural = isDocumentsSection ? "sidebar items" : itemLabelPlural;
    const canManagePages = userCanManagePages(req.user);
    const pagesBaseUrl = `/admin/projects/${project.id}/versions/${version.id}/pages`;
    const extraJs = [];

    if (!search) {
      extraJs.push("/js/sidebar-sort.js");
    }

    if (section === PAGE_SECTIONS.DOCUMENTS) {
      extraJs.push("/js/sidebar-navigation.js");
    }

    if (canManagePages) {
      extraJs.push("/js/page-selection.js", "/js/markdown-import.js");
    }

    res.render("admin/pages/index", {
      title: nonVersionedMode ? `${project.name} - ${sectionLabel}` : `${project.name} - ${version.label} - ${sectionLabel}`,
      headerSearch: {
        action: pagesBaseUrl,
        params: { section },
        placeholder: `Search ${sectionLabel}...`,
        value: search,
      },
      pageListActions: {
        publicUrl: publicSectionUrl(project, version, section),
        editProjectUrl: canManagePages && nonVersionedMode ? `/admin/projects/${project.id}/edit` : null,
        exportProjectUrl: canManagePages ? `/admin/projects/${project.id}/export` : null,
        showImportAction: canManagePages,
        batchDelete: canManagePages
          ? {
              action: `${pagesBaseUrl}/delete-selected`,
              section,
              itemLabel: selectionItemLabel,
              itemLabelPlural: selectionItemLabelPlural,
            }
          : null,
        create: canManagePages
          ? {
              url: `${pagesBaseUrl}/new?section=${section}`,
              label: isDocumentsSection ? "Item" : "Article",
            }
          : null,
      },
      project,
      version,
      section,
      sectionLabel,
      sectionOption,
      sectionOptions: PAGE_SECTION_OPTIONS,
      pageItemTypes: PAGE_ITEM_TYPES,
      pages,
      pageTreeItems,
      pagination: { page: pagesResult.page, totalPages: pagesResult.totalPages, totalItems: pagesResult.totalItems },
      search,
      user: req.user,
      csrfToken: res.locals.csrfToken,
      error: req.query.error || null,
      success: req.query.success || null,
      siteName: env.SITE_NAME,
      markdownImport: MARKDOWN_IMPORT,
      extraJs: extraJs.length > 0 ? extraJs : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/new", csrfMiddleware, requireProjectAccess(ROLES.ADMIN), async (req, res, next) => {
  try {
    const section = selectedSection(req);
    const context = await getAdminContext(req);
    return renderNewItemEditor(res, req, context, section);
  } catch (err) {
    next(err);
  }
});

router.post("/new", csrfMiddleware, requireProjectAccess(ROLES.ADMIN), async (req, res, next) => {
  try {
    const section = selectedSection(req);
    const context = await getAdminContext(req);
    const itemType = section === PAGE_SECTIONS.DOCUMENTS ? req.body.itemType || PAGE_ITEM_TYPES.PAGE : PAGE_ITEM_TYPES.PAGE;

    if (itemType !== PAGE_ITEM_TYPES.PAGE) {
      const parsed = createSidebarItemSchema.safeParse(req.body);
      if (!parsed.success) {
        return renderNewItemEditor(res, req, context, section, {
          statusCode: 422,
          error: parsed.error.issues[0].message,
          formValues: req.body,
        });
      }

      const item = await createSidebarNavigationItem(context.version.id, parsed.data, req.requestId);
      const label = item.item_type === PAGE_ITEM_TYPES.HEADER ? "Header" : "Separator";
      return res.redirect(pageAdminUrl(context.project.id, context.version.id, PAGE_SECTIONS.DOCUMENTS, { success: `${label} added to the public sidebar.` }));
    }

    const parsed = createPageSchema.safeParse({ ...req.body, section });
    if (!parsed.success) {
      return renderNewItemEditor(res, req, context, section, {
        statusCode: 422,
        error: parsed.error.issues[0].message,
        formValues: req.body,
      });
    }

    await createPage(req.params.versionId, parsed.data, req.requestId);
    res.redirect(pageAdminUrl(context.project.id, context.version.id, section, { success: "Page created." }));
  } catch (err) {
    if (err.statusCode === 409 || err.statusCode === 422) {
      const section = selectedSection(req);
      const context = await getAdminContext(req);
      return renderNewItemEditor(res, req, context, section, {
        statusCode: err.statusCode,
        error: err.message,
        formValues: req.body,
      });
    }
    next(err);
  }
});

router.post("/sidebar-items/:itemId", csrfMiddleware, requireProjectAccess(ROLES.ADMIN, ROLES.EDITOR), async (req, res, next) => {
  try {
    const context = await getAdminContext(req);
    const parsed = updateSidebarHeaderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.redirect(303, pageAdminUrl(context.project.id, context.version.id, PAGE_SECTIONS.DOCUMENTS, { error: parsed.error.issues[0].message }));
    }

    const item = await getPage(req.params.itemId);
    assertPageBelongsToVersion(item, context.version.id);
    await updateSidebarHeader(item.id, parsed.data, req.requestId);
    res.redirect(pageAdminUrl(context.project.id, context.version.id, PAGE_SECTIONS.DOCUMENTS, { success: "Sidebar header updated." }));
  } catch (err) {
    if (err.statusCode === 422) {
      return res.redirect(303, pageAdminUrl(req.params.projectId, req.params.versionId, PAGE_SECTIONS.DOCUMENTS, { error: err.message }));
    }
    next(err);
  }
});

router.post("/sidebar-items/:itemId/delete", csrfMiddleware, requireProjectAccess(ROLES.ADMIN), async (req, res, next) => {
  try {
    const context = await getAdminContext(req);
    const item = await getPage(req.params.itemId);
    assertPageBelongsToVersion(item, context.version.id);
    await deleteSidebarNavigationItem(item.id, req.requestId);
    res.redirect(pageAdminUrl(context.project.id, context.version.id, PAGE_SECTIONS.DOCUMENTS, { success: "Sidebar item deleted." }));
  } catch (err) {
    next(err);
  }
});

router.get("/:pageId", csrfMiddleware, requireProjectAccess(), async (req, res, next) => {
  try {
    const context = await getAdminContext(req);
    const page = await getPage(req.params.pageId);
    assertPageBelongsToVersion(page, context.version.id);
    if (!isPageContentItem(page)) {
      throw new NotFoundError("Page");
    }
    const section = assertPageSection(page.section || PAGE_SECTIONS.DOCUMENTS);
    const pagesResult = await listPages(context.version.id, section);

    return renderEditor(res, req, context, {
      title: `Edit - ${page.title}`,
      section,
      page,
      pages: pagesResult.items || [],
    });
  } catch (err) {
    next(err);
  }
});

router.post("/reorder", csrfMiddleware, requireProjectAccess(ROLES.ADMIN, ROLES.EDITOR), async (req, res, next) => {
  try {
    const section = selectedSection(req);
    let pages;
    try {
      pages = typeof req.body.pages === "string" ? JSON.parse(req.body.pages) : req.body.pages;
    } catch {
      return res.status(400).json({ error: { code: "INVALID_FORMAT", message: "Invalid page order data." } });
    }

    const parsed = reorderPagesSchema.safeParse({ pages });
    if (!parsed.success) {
      return res.status(422).json({ error: { code: "VALIDATION_FAILED", message: "Invalid reorder data." } });
    }

    await getAdminContext(req);
    await reorderPages(req.params.versionId, section, parsed.data.pages, req.requestId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post("/import", csrfMiddleware, requireProjectAccess(ROLES.ADMIN), async (req, res, next) => {
  try {
    const section = selectedSection(req);
    const parsed = importMarkdownPagesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        error: {
          code: "VALIDATION_FAILED",
          message: "Invalid Markdown import data.",
          details: validationDetails(parsed.error),
          requestId: req.requestId,
        },
      });
    }

    await getAdminContext(req);
    const importResult = await importMarkdownPages(req.params.versionId, section, parsed.data.files, req.requestId);
    const { pages, createdCount, updatedCount, updatedPageIds } = importResult;
    const importedCount = pages.length;
    const sectionOption = getPageSectionOption(section);
    const importSummary = [createdCount > 0 ? `${createdCount} created` : "", updatedCount > 0 ? `${updatedCount} updated` : ""].filter(Boolean).join(", ");
    const successMessage = `${importedCount} ${sectionOption.itemLabel}${importedCount !== 1 ? "s" : ""} processed: ${importSummary}.`;
    res.status(201).json({
      ok: true,
      importedCount,
      createdCount,
      updatedCount,
      updatedPageIds,
      pages: pages.map((page) => ({
        id: page.id,
        title: page.title,
        slug: page.slug,
        section: page.section,
      })),
      redirectUrl: pageAdminUrl(req.params.projectId, req.params.versionId, section, { success: successMessage }),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/delete-selected", csrfMiddleware, requireProjectAccess(ROLES.ADMIN), async (req, res, next) => {
  try {
    const parsed = deletePagesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({ error: { code: "VALIDATION_FAILED", message: parsed.error.issues[0].message } });
    }

    const section = selectedSection(req);
    const context = await getAdminContext(req);
    const removedCount = await deletePages(context.version.id, section, parsed.data.pageIds, req.requestId);
    const sectionOption = getPageSectionOption(section);
    const removedLabel = section === PAGE_SECTIONS.DOCUMENTS ? (removedCount === 1 ? "sidebar item" : "sidebar items") : removedCount === 1 ? sectionOption.itemLabel : sectionOption.itemLabelPlural;

    res.redirect(pageAdminUrl(req.params.projectId, req.params.versionId, section, { success: `${removedCount} ${removedLabel} removed.` }));
  } catch (err) {
    next(err);
  }
});

router.post("/:pageId", csrfMiddleware, requireProjectAccess(ROLES.ADMIN, ROLES.EDITOR), async (req, res, next) => {
  try {
    const parsed = updatePageSchema.safeParse(req.body);
    const context = await getAdminContext(req);
    const page = await getPage(req.params.pageId);
    assertPageBelongsToVersion(page, context.version.id);
    if (!isPageContentItem(page)) {
      throw new NotFoundError("Page");
    }
    const section = assertPageSection(page.section || PAGE_SECTIONS.DOCUMENTS);

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const pagesResult = await listPages(context.version.id, section);
      return renderEditor(res, req, context, {
        statusCode: 422,
        title: `Edit - ${page.title}`,
        section,
        page,
        pages: pagesResult.items || [],
        error: firstIssue.message,
        formValues: req.body,
      });
    }

    await updatePage(req.params.pageId, parsed.data, req.requestId);
    res.redirect(pageAdminUrl(context.project.id, context.version.id, section, { success: "Page saved." }));
  } catch (err) {
    if (err.statusCode === 409 || err.statusCode === 422) {
      const context = await getAdminContext(req);
      const page = await getPage(req.params.pageId);
      assertPageBelongsToVersion(page, context.version.id);
      const section = assertPageSection(page.section || PAGE_SECTIONS.DOCUMENTS);
      const pagesResult = await listPages(context.version.id, section);
      return renderEditor(res, req, context, {
        statusCode: err.statusCode,
        title: `Edit - ${page.title}`,
        section,
        page,
        pages: pagesResult.items || [],
        error: err.message,
        formValues: req.body,
      });
    }
    next(err);
  }
});

router.post("/:pageId/delete", csrfMiddleware, requireProjectAccess(ROLES.ADMIN), async (req, res, next) => {
  try {
    const context = await getAdminContext(req);
    const page = await getPage(req.params.pageId);
    assertPageBelongsToVersion(page, context.version.id);
    if (!isPageContentItem(page)) {
      throw new NotFoundError("Page");
    }
    const section = assertPageSection(page.section || PAGE_SECTIONS.DOCUMENTS);
    await deletePage(req.params.pageId, req.requestId);
    res.redirect(pageAdminUrl(req.params.projectId, req.params.versionId, section, { success: "Page deleted." }));
  } catch (err) {
    next(err);
  }
});

export default router;
