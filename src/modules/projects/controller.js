/**
 * @module projects/controller
 * @description Express routes for CRUD operations on documentation projects.
 */
import { Router } from "express";
import { listProjects, getProject, createProject, updateProject, deleteProject, exportProject } from "./service.js";
import { listVersionsPaginated, listVersions } from "../versions/service.js";
import { createProjectSchema, updateProjectSchema } from "./validation.js";
import { validate } from "../../middleware/validate.js";
import { requireAuth, requireRole, requireProjectAccess } from "../../middleware/auth.js";
import { csrfMiddleware } from "../../middleware/csrf.js";
import { COOKIE_NAMES, ROLES, PROJECT_MODE, PAGE_SECTIONS } from "../../config/constants.js";
import { env } from "../../config/env.js";
import { ZipArchive } from "archiver";

const router = Router();

router.use(requireAuth);

router.get("/", csrfMiddleware, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const search = (req.query.search || "").trim();
    const result = await listProjects(page, search);
    const totalProjects = result.totalItems ?? (result.items || []).length;
    res.render("admin/projects/index", {
      title: "Projects",
      headerSubtitle: `${totalProjects} project${totalProjects !== 1 ? "s" : ""}`,
      headerSearch: {
        action: "/admin/projects",
        placeholder: "Search projects...",
        value: search,
      },
      projects: result.items || [],
      pagination: { page: result.page, totalPages: result.totalPages, totalItems: result.totalItems },
      search,
      user: req.user,
      csrfToken: res.locals.csrfToken,
      siteName: env.SITE_NAME,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/create", csrfMiddleware, requireRole(ROLES.ADMIN, ROLES.OWNER), (req, res) => {
  res.render("admin/projects/create", {
    title: "New Project",
    user: req.user,
    csrfToken: res.locals.csrfToken,
    error: null,
    values: {},
    siteName: env.SITE_NAME,
  });
});

router.post("/create", csrfMiddleware, requireRole(ROLES.ADMIN, ROLES.OWNER), validate(createProjectSchema), async (req, res, next) => {
  try {
    const project = await createProject(req.validatedBody, req.user.id, req.requestId);
    res.redirect(`/admin/projects/${project.id}?success=Project created.`);
  } catch (err) {
    if (err.statusCode === 409 || err.statusCode === 422) {
      return res.status(err.statusCode).render("admin/projects/create", {
        title: "New Project",
        user: req.user,
        csrfToken: res.locals.csrfToken,
        error: err.message,
        values: req.validatedBody,
        siteName: env.SITE_NAME,
      });
    }
    next(err);
  }
});

router.get("/:projectId", csrfMiddleware, requireProjectAccess(), async (req, res, next) => {
  try {
    const search = (req.query.search || "").trim();
    const project = await getProject(req.params.projectId);
    const projectMode = project.mode || PROJECT_MODE.VERSIONED;
    const canManageProject = req.user.role === ROLES.OWNER || req.user.role === ROLES.ADMIN;
    const pageListActions = {
      publicUrl: `/docs/${project.slug}`,
      editProjectUrl: canManageProject ? `/admin/projects/${project.id}/edit` : null,
      create:
        canManageProject && projectMode === PROJECT_MODE.VERSIONED
          ? {
              url: `/admin/projects/${project.id}/versions/create`,
              label: "Version",
            }
          : null,
    };

    if (projectMode === PROJECT_MODE.NON_VERSIONED) {
      const versionsResult = await listVersions(project.id);
      const defaultVersion = versionsResult.items?.[0];
      if (!defaultVersion) {
        return res.render("admin/projects/show", {
          title: project.name,
          pageListActions,
          project,
          defaultVersion: null,
          pages: [],
          pagination: { page: 1, totalPages: 1, totalItems: 0 },
          search,
          user: req.user,
          csrfToken: res.locals.csrfToken,
          success: req.query.success || null,
          siteName: env.SITE_NAME,
        });
      }

      const query = new URLSearchParams();
      if (req.query.success) {
        query.set("success", String(req.query.success));
      }
      if (search) {
        query.set("search", search);
      }

      const suffix = query.toString() ? `?${query.toString()}` : "";
      return res.redirect(`/admin/projects/${project.id}/versions/${defaultVersion.id}/pages${suffix}`);
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const versionsResult = await listVersionsPaginated(project.id, page, search);
    res.render("admin/projects/show", {
      title: project.name,
      pageListActions,
      headerSearch: {
        action: `/admin/projects/${project.id}`,
        placeholder: "Search versions...",
        value: search,
      },
      project,
      versions: versionsResult.items || [],
      pagination: { page: versionsResult.page, totalPages: versionsResult.totalPages, totalItems: versionsResult.totalItems },
      search,
      user: req.user,
      csrfToken: res.locals.csrfToken,
      success: req.query.success || null,
      siteName: env.SITE_NAME,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:projectId/edit", csrfMiddleware, requireProjectAccess(ROLES.ADMIN), async (req, res, next) => {
  try {
    const project = await getProject(req.params.projectId);
    res.render("admin/projects/edit", {
      title: `Edit - ${project.name}`,
      project,
      user: req.user,
      csrfToken: res.locals.csrfToken,
      error: null,
      success: req.query.success || null,
      siteName: env.SITE_NAME,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/:projectId/export", requireProjectAccess(ROLES.ADMIN), async (req, res, next) => {
  try {
    const data = await exportProject(req.params.projectId);
    const downloadToken = String(req.query.downloadToken || "")
      .trim()
      .slice(0, 80);

    if (downloadToken) {
      res.cookie(COOKIE_NAMES.DOWNLOAD_TOKEN, downloadToken, {
        httpOnly: false,
        secure: env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 60 * 1000,
      });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${data.project.slug}.zip"`);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (err) => next(err));
    archive.pipe(res);

    const mode = data.project.mode || PROJECT_MODE.VERSIONED;
    const shouldExportChangelog = mode === PROJECT_MODE.VERSIONED;

    for (const { version, pages, changelog } of data.versions) {
      const folder = `${version.slug}/`;

      if (shouldExportChangelog) {
        archive.append(changelog?.content || "", { name: `${folder}_CHANGELOG.md` });
      }

      for (const page of pages) {
        if ((page.section || PAGE_SECTIONS.DOCUMENTS) === PAGE_SECTIONS.DOCUMENTS) {
          archive.append(page.content || "", { name: `${folder}${page.slug}.md` });
        } else {
          archive.append(page.content || "", {
            name: `${folder}knowledge-base/${page.section}/${page.slug}.md`,
          });
        }
      }
    }

    await archive.finalize();
  } catch (err) {
    next(err);
  }
});

router.post("/:projectId", csrfMiddleware, requireProjectAccess(ROLES.ADMIN), validate(updateProjectSchema), async (req, res, next) => {
  try {
    await updateProject(req.params.projectId, req.validatedBody, req.requestId);
    res.redirect(`/admin/projects/${req.params.projectId}?success=Project updated successfully.`);
  } catch (err) {
    if (err.statusCode === 409 || err.statusCode === 422) {
      const project = await getProject(req.params.projectId);
      return res.status(err.statusCode).render("admin/projects/edit", {
        title: project.name,
        project: { ...project, ...req.validatedBody },
        user: req.user,
        csrfToken: res.locals.csrfToken,
        error: err.message,
        success: null,
        siteName: env.SITE_NAME,
      });
    }
    next(err);
  }
});

router.post("/:projectId/delete", csrfMiddleware, requireProjectAccess(ROLES.ADMIN), async (req, res, next) => {
  try {
    await deleteProject(req.params.projectId, req.requestId);
    res.redirect("/admin/projects?success=Project deleted.");
  } catch (err) {
    next(err);
  }
});

export default router;
