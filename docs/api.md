# API Reference

All endpoints are served by the Express application. Admin endpoints require authentication (cookie-based). Public endpoints are unauthenticated.

## Conventions

- **Content-Type**: `application/x-www-form-urlencoded` for form submissions, `application/json` for API responses
- **Authentication**: Cookie `pd_auth` containing a PocketBase JWT token
- **CSRF**: Routes protected by CSRF middleware require a `_csrf` body field or `x-csrf-token` header containing the HMAC-SHA256 signature derived from the httpOnly `pd_csrf` cookie
- **Validation errors** return HTTP 422 with field-level details
- **Slugs** must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` (lowercase alphanumeric with hyphens)

## Error Response Format

JSON error responses use a consistent envelope. Browser-facing routes can render an HTML error page or redirect instead.

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Human-readable description",
    "details": [
      { "field": "slug", "code": "INVALID_FORMAT", "message": "Invalid slug format" }
    ],
    "requestId": "uuid-v4"
  }
}
```

| HTTP Status | Error Code | Meaning |
|-------------|-----------|---------|
| 422 | `VALIDATION_FAILED` | Invalid input |
| 401 | `UNAUTHORIZED` | Not logged in or token expired |
| 403 | `FORBIDDEN` | Insufficient role/permissions |
| 403 | `CSRF_INVALID` | CSRF token mismatch |
| 403 | `IP_RESTRICTED` | Client IP not in allowlist |
| 404 | `RESOURCE_NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Duplicate resource (e.g. slug already taken) |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 500 | `INFRASTRUCTURE_ERROR` | Internal database or filesystem failure |
| 502 | `EXTERNAL_SERVICE_ERROR` | Upstream service failure |

---

## Health Check

### `GET /health`

Returns server health status and PocketBase connectivity.

**Auth:** None

**Response (200 — healthy):**
```json
{
  "status": "healthy",
  "uptime_s": 3600,
  "memory": {
    "rss_mb": 85,
    "heap_used_mb": 42,
    "heap_total_mb": 64
  }
}
```

**Response (503 — unhealthy):**
```json
{
  "status": "unhealthy",
  "uptime_s": 3600,
  "checks": { "pocketbase": "unreachable" }
}
```

---

## Site Icon

### `GET /site-icon`

Returns the custom public site icon stored in PocketBase, or the bundled PocketDocs SVG when no custom icon is configured. The custom icon response uses a versioned URL and long-lived immutable caching.

**Auth:** None

### `GET /favicon.ico`

Returns the same current site icon without long-lived caching, for browser favicon discovery.

**Auth:** None

---

## Setup

### `GET /setup`

Renders the owner registration form. Redirects to `/auth/login` if owner already exists.

**Auth:** None

### `POST /setup`

Creates the initial owner account. Only available when no owner exists.

**Rate limit:** Auth limiter (10 requests / 15 min)

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | Yes | 2–100 characters |
| `email` | string | Yes | Valid email, max 255 |
| `password` | string | Yes | 8–256 characters |
| `passwordConfirm` | string | Yes | Must match `password` |
| `_csrf` | string | Yes | CSRF token |

**Success:** Sets `pd_auth` cookie, redirects to `/admin`

**Errors:** 422 (validation), 409 (owner already exists)

---

## Authentication

### `GET /auth/login`

Renders the login form. IP-restricted.

**Auth:** None

### `POST /auth/login`

Authenticates a user with email and password.

**Rate limit:** Auth limiter (10 requests / 15 min)  
**IP restriction:** Yes

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `email` | string | Yes | Valid email, max 255 |
| `password` | string | Yes | 8–256 characters |
| `_csrf` | string | Yes | CSRF token |

**Success:** Sets `pd_auth` cookie (httpOnly, secure in production, sameSite: strict, 7-day expiry), redirects to `/admin`

**Errors:** 422 (validation), 401 (invalid credentials)

### `POST /auth/logout`

Clears the auth session.

**Auth:** None (cookie is cleared regardless)

**CSRF:** No

**Success:** Clears `pd_auth` cookie, redirects to `/auth/login`

---

## Projects

All project routes require authentication and IP restriction. Routes under `/admin/projects`.

### `GET /admin/projects`

Lists all projects accessible to the current user, paginated.

**Auth:** Required  
**Roles:** All

**Query:**

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `page` | integer | 1 | ≥ 1 |
| `search` | string | empty | Filters project name or slug |

**Response:** Renders the filtered, paginated project list available to authenticated users.

### `GET /admin/projects/create`

Renders the project creation form.

**Auth:** Required  
**Roles:** Admin, Owner

### `POST /admin/projects/create`

Creates a new project.

**Auth:** Required  
**Roles:** Admin, Owner  
**CSRF:** Yes

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | Yes | 1–200 characters |
| `slug` | string | Yes | 1–120 characters, slug pattern |
| `description` | string | No | Max 500 characters |
| `visibility` | string | No | `public` or `private` (default: `private`) |
| `mode` | string | No | `versioned` or `non_versioned` (default: `versioned`) |
| `_csrf` | string | Yes | CSRF token |

**Success:** Redirects to `/admin/projects/:projectId`

**Errors:** 422 (validation), 409 (slug taken)

### `GET /admin/projects/:projectId`

Shows project details and its versions.

For Non-Versioned projects, this route redirects to the pages list of the internal default version with Documents/FAQ/Troubleshooting section navigation.

For Versioned projects, `page` selects the paginated version result and `search` filters version labels and slugs.

**Auth:** Required  
**Roles:** Owner, Admin, Editor (with project access)

### `GET /admin/projects/:projectId/edit`

Renders the project edit form.

**Auth:** Required  
**Roles:** Admin, Owner

### `GET /admin/projects/:projectId/export`

Streams project content as a ZIP archive. Each version becomes a folder named by its slug. Documents export as `{slug}.md`, FAQ/Troubleshooting files export under `knowledge-base/{section}/{slug}.md`, and versioned projects include `_CHANGELOG.md`.

**Auth:** Required  
**Roles:** Admin, Owner

**Query:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `downloadToken` | string | No | Client-generated opaque token (≤ 80 chars). When provided, the server sets a short-lived `pd_download` cookie so the browser know the download has started. |

**Response:** `Content-Type: application/zip`, `Content-Disposition: attachment; filename="{slug}.zip"`

**Errors:** 403 (insufficient role), 404 (project not found)

### `POST /admin/projects/:projectId`

Updates project metadata.

**Auth:** Required  
**Roles:** Admin, Owner  
**CSRF:** Yes

**Body:** Same fields as create (all optional — partial update).

Note: `mode` is immutable after creation and is not accepted in update payloads.

**Success:** Redirects to `/admin/projects/:projectId`

### `POST /admin/projects/:projectId/delete`

Deletes a project and all its versions, content pages, and changelogs.

**Auth:** Required  
**Roles:** Admin, Owner  
**CSRF:** Yes

**Success:** Redirects to `/admin/projects`

---

## Versions

All version routes require authentication and project access. Routes under `/admin/projects/:projectId/versions`.

### `GET /admin/projects/:projectId/versions`

Redirects to the parent project page.

### `GET /admin/projects/:projectId/versions/create`

Renders the version creation form, showing existing versions for cloning.

**Auth:** Required  
**Roles:** Admin, Owner

### `POST /admin/projects/:projectId/versions`

Creates a new version for the project.

**Auth:** Required  
**Roles:** Admin, Owner  
**CSRF:** Yes

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `label` | string | Yes | 1–100 characters |
| `is_public` | boolean | No | Default: `false` |
| `clone_from` | string | No | Version ID to clone pages from (max 15 chars) |
| `_csrf` | string | Yes | CSRF token |

**Success:** Redirects to `/admin/projects/:projectId`

### `GET /admin/projects/:projectId/versions/:versionId/edit`

Renders the version edit form.

**Auth:** Required  
**Roles:** All (with project access)

### `POST /admin/projects/:projectId/versions/:versionId`

Updates a version.

**Auth:** Required  
**Roles:** Admin, Editor, Owner  
**CSRF:** Yes

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `label` | string | No | 1–100 characters |
| `is_public` | boolean | No | — |
| `order` | integer | No | ≥ 0 |
| `_csrf` | string | Yes | CSRF token |

**Success:** Redirects to project page

### `POST /admin/projects/:projectId/versions/:versionId/delete`

Deletes a version and all its content pages and changelog.

**Auth:** Required  
**Roles:** Admin, Owner  
**CSRF:** Yes

**Success:** Redirects to project page

---

## Pages

All page routes require authentication and project access. Routes under `/admin/projects/:projectId/versions/:versionId/pages`.

### `GET /admin/projects/:projectId/versions/:versionId/pages`

Lists one content section. Without a search term, each section is displayed as an ordered hierarchy; Documents can also contain sidebar headers and separators. Search results are flat. The admin interface progressively appends subsequent result pages through **Load more**.

**Auth:** Required  
**Roles:** All (with project access)

**Query:**

| Param | Type | Default | Constraints |
|-------|------|---------|-------------|
| `section` | string | `documents` | `documents`, `faq`, or `troubleshooting` |
| `page` | integer | 1 | ≥ 1 |
| `search` | string | empty | Filters titles and slugs; matching results are shown as a flat list |

### `GET /admin/projects/:projectId/versions/:versionId/pages/new`

Renders the unified item editor. Documents can create a page, sidebar header, or sidebar separator; FAQ and Troubleshooting create articles.

**Auth:** Required  
**Roles:** Admin, Owner

### `POST /admin/projects/:projectId/versions/:versionId/pages/new`

Creates a page/article or, for the Documents section, a sidebar header or separator.

**Auth:** Required  
**Roles:** Admin, Owner  
**CSRF:** Yes

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `section` | string | No | `documents`, `faq`, or `troubleshooting`; default `documents` |
| `itemType` | string | No | `page` (default), `header`, or `separator`; non-page values apply only to Documents |
| `collapsed_by_default` | string | No | Header only; `true` or `false` (default `false`); controls the initial public sidebar group state |
| `title` | string | Conditional | 1–200 characters; required for pages/articles and headers, optional for separators |
| `slug` | string | Page/article only | 1–120 characters, slug pattern |
| `content` | string | No | Page/article only; max 500,000 characters |
| `parent` | string | No | Page/article only; page ID (max 15 chars), empty string for root |
| `icon` | string | No | Page/article only; max 50 characters |
| `_csrf` | string | Yes | CSRF token |

**Success:** Pages/articles redirect to the page editor. Headers and separators redirect to the Documents list.

### `POST /admin/projects/:projectId/versions/:versionId/pages/import`

Bulk-imports Markdown files as pages. Relative folder paths are preserved by creating or reusing folder pages as parents before importing child pages. The server infers each page title from the first Markdown H1, falling back to the filename, and infers each slug from the filename or folder name. If an inferred page slug already exists in the same version and section, the existing page's title, content, and imported hierarchy are updated while its ID, icon, and order are preserved.

**Auth:** Required  
**Roles:** Admin, Owner  
**CSRF:** Yes  
**Content-Type:** `application/json`

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `files` | array | Yes | At least 1 item; limited by total content size |
| `files[].filename` | string | Yes | Max 500 characters, optional relative folders, `.md` or `.markdown` |
| `files[].content` | string | Yes | Max 500,000 characters per file; max 1,500,000 characters total |

**Success (201):**
```json
{
  "ok": true,
  "importedCount": 2,
  "createdCount": 1,
  "updatedCount": 1,
  "updatedPageIds": ["def456abc123789"],
  "pages": [
    { "id": "abc123def456789", "title": "Getting Started", "slug": "getting-started", "section": "documents" },
    { "id": "def456abc123789", "title": "API Reference", "slug": "api-reference", "section": "documents" }
  ],
  "redirectUrl": "/admin/projects/proj123/versions/ver123/pages?success=2%20pages%20processed%3A%201%20created%2C%201%20updated."
}
```

**Errors:** 409 when a folder slug exists under another parent or a concurrent write creates a slug collision; 422 for invalid files, duplicate imported slugs, unsupported extensions, path traversal, or oversized content.

### `POST /admin/projects/:projectId/versions/:versionId/pages/delete-selected`

Deletes selected content or sidebar items from one section.

**Auth:** Required

**Roles:** Admin, Owner

**CSRF:** Yes

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `pageIds` | string or array | Yes | 1–100 record IDs, each up to 15 characters; duplicates are ignored |
| `section` | string | No | `documents`, `faq`, or `troubleshooting`; default `documents` |
| `_csrf` | string | Yes | CSRF token |

**Success:** Redirects to the selected section with the number of removed items.

### `POST /admin/projects/:projectId/versions/:versionId/pages/sidebar-items/:itemId`

Updates the title and default expanded/collapsed state of an existing Documents sidebar header.

**Auth:** Required

**Roles:** Admin, Editor, Owner

**CSRF:** Yes

**Body:** `title` (required, 1–200 characters), `collapsed_by_default` (`true` or `false`, default `false`), and `_csrf`.

### `POST /admin/projects/:projectId/versions/:versionId/pages/sidebar-items/:itemId/delete`

Deletes an existing Documents sidebar header or separator.

**Auth:** Required

**Roles:** Admin, Owner

**CSRF:** Yes

### `GET /admin/projects/:projectId/versions/:versionId/pages/:pageId`

Renders the page editor with existing content.

**Auth:** Required  
**Roles:** All (with project access)

### `POST /admin/projects/:projectId/versions/:versionId/pages/:pageId`

Updates an existing page.

**Auth:** Required  
**Roles:** Admin, Editor, Owner  
**CSRF:** Yes

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `title` | string | No | 1–200 characters |
| `slug` | string | No | 1–120 characters, slug pattern |
| `content` | string | No | Max 500,000 characters |
| `parent` | string | No | Page ID (max 15 characters) or empty string |
| `icon` | string | No | Max 50 characters |
| `order` | integer | No | ≥ 0 |
| `_csrf` | string | Yes | CSRF token |

`section` and `itemType` are not updateable.

**Success:** Redirects to page editor

### `POST /admin/projects/:projectId/versions/:versionId/pages/:pageId/delete`

Deletes a page.

**Auth:** Required  
**Roles:** Admin, Owner  
**CSRF:** Yes

**Success:** Redirects to pages list

### `POST /admin/projects/:projectId/versions/:versionId/pages/reorder`

Reorders pages and updates parent relationships.

**Auth:** Required  
**Roles:** Admin, Editor, Owner  
**CSRF:** Yes

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `pages` | array | Yes | Min 1 item |
| `pages[].id` | string | Yes | 1–15 characters |
| `pages[].order` | integer | Yes | ≥ 0 |
| `pages[].parent` | string | No | Page ID or empty string |
| `_csrf` | string | Yes | CSRF token |

**Success:** JSON `{ "ok": true }`

---

## Changelogs

Routes under `/admin/projects/:projectId/versions/:versionId/changelog`.

### `GET /admin/projects/:projectId/versions/:versionId/changelog`

Renders the changelog editor for the version.

**Auth:** Required  
**Roles:** All (with project access)

### `POST /admin/projects/:projectId/versions/:versionId/changelog`

Creates or updates the changelog for the version (upsert).

**Auth:** Required  
**Roles:** Admin, Owner  
**CSRF:** Yes

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `content` | string | Yes | 1–500,000 characters |
| `_csrf` | string | Yes | CSRF token |

**Success:** Redirects to changelog editor

---

## Content Sections

Routes under `/admin/projects/:projectId/versions/:versionId/pages` manage all fixed content sections: Documents (`documents`), Frequently Asked Questions (`faq`), and Troubleshooting (`troubleshooting`). The selected section is passed with the `section` query/body value and defaults to `documents`.

### Section-aware page routes

The existing page routes support all sections:

| Route | Purpose |
|-------|---------|
| `GET /admin/projects/:projectId/versions/:versionId/pages?section=faq` | Lists one section |
| `GET /admin/projects/:projectId/versions/:versionId/pages/new?section=faq` | Renders the editor for that section |
| `POST /admin/projects/:projectId/versions/:versionId/pages/new?section=faq` | Creates a page/article in that section |
| `POST /admin/projects/:projectId/versions/:versionId/pages/import?section=faq` | Imports Markdown into that section |
| `POST /admin/projects/:projectId/versions/:versionId/pages/delete-selected?section=faq` | Deletes selected articles from that section |
| `POST /admin/projects/:projectId/versions/:versionId/pages/reorder?section=faq` | Reorders pages/articles in that section |
| `GET /admin/projects/:projectId/versions/:versionId/pages/:pageId` | Edits an existing page/article |
| `POST /admin/projects/:projectId/versions/:versionId/pages/:pageId` | Updates an existing page/article |
| `POST /admin/projects/:projectId/versions/:versionId/pages/:pageId/delete` | Deletes an existing page/article |

`slug` values are unique per version + section. Parent pages must belong to the same version + section.

---

## Users

All user routes require Owner role. Routes under `/admin/users`.

### `GET /admin/users`

Lists all users, paginated.

**Auth:** Required  
**Roles:** Owner

**Query:**

| Param | Type | Default |
|-------|------|---------|
| `page` | integer | 1 |
| `search` | string | empty; filters name or email |

### `GET /admin/users/:id/edit`

Renders the users list with the specified user loaded for editing.

**Auth:** Required  
**Roles:** Owner

**Query:**

| Param | Type | Default |
|-------|------|---------|
| `page` | integer | 1 |
| `search` | string | empty; filters name or email |

### `POST /admin/users/create`

Creates a new user.

**Auth:** Required  
**Roles:** Owner  
**CSRF:** Yes

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | Yes | 2–100 characters |
| `email` | string | Yes | Valid email, max 255 |
| `password` | string | Yes | 8–256 characters |
| `passwordConfirm` | string | Yes | Must match `password` |
| `role` | string | Yes | `admin` or `editor` |
| `_csrf` | string | Yes | CSRF token |

**Success:** Redirects to users list

**Errors:** 422 (validation), 409 (email taken)

### `POST /admin/users/:id/update`

Updates an existing user.

**Auth:** Required  
**Roles:** Owner  
**CSRF:** Yes

**Body:**

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | Yes | 2–100 characters |
| `email` | string | Yes | Valid email, max 255 |
| `role` | string | Yes | `admin` or `editor` |
| `password` | string | No | 8–256 characters if provided |
| `passwordConfirm` | string | No | Must match `password` if provided |
| `_csrf` | string | Yes | CSRF token |

### `POST /admin/users/:id/delete`

Deletes a user. Cannot delete yourself.

**Auth:** Required  
**Roles:** Owner  
**CSRF:** Yes

**Success:** Redirects to users list

---

## Settings

Routes under `/admin/settings`.

### `GET /admin/settings`

Renders the settings page with current site settings and IP restriction configuration.

**Auth:** Required  
**Roles:** Admin, Owner

### `POST /admin/settings`

Updates site settings and (optionally) IP restriction rules.

**Auth:** Required  
**Roles:** Admin (site settings only), Owner (site settings + IP restriction)  
**CSRF:** Yes

**Body:**

| Field | Type | Required | Constraints | Notes |
|-------|------|----------|-------------|-------|
| `heroTitle` | string | Yes | 1–200 characters | Sanitized inline Markdown; controls homepage hero, public homepage header, and browser title |
| `heroSubtitle` | string | No | Max 300 characters | Sanitized inline Markdown shown below the homepage title |
| `siteIcon` | string | No | Base64 data URL for PNG, JPEG, WebP, or safe SVG; decoded file ≤ 256 KB | Replaces the current PocketBase-backed site icon |
| `removeSiteIcon` | string | No | `true` or `false` (default) | Restores the bundled PocketDocs icon when `true` and no replacement icon is supplied |
| `enabled` | string | Owner only | `enable` or `disable` | Required when an Owner updates settings; omitted for Admin requests |
| `allowedIps` | string | No | Max 5,000 characters | Newline-separated IP allowlist (Owner only) |
| `_csrf` | string | Yes | CSRF token | |

**Success:** Redirects to settings page

---

## Public Routes

### `GET /`

Home page showing all public projects. Its hero title, subtitle, public header title, browser title, and public site icon come from the PocketBase `site_settings` records. The footer branding remains PocketDocs.

**Auth:** None

### `GET /docs/:projectSlug`

Project landing page.

- Versioned project: redirects to the first public version's first document, then FAQ/Troubleshooting if no documents exist.
- Non-Versioned project: redirects to the first document using `/docs/:projectSlug/:pageSlug`, then FAQ/Troubleshooting if no documents exist.

**Auth:** None

### `GET /docs/:projectSlug/:segment`

Non-Versioned document route. Renders a document directly without version slug.

If the project is versioned, routing falls through to versioned routes.

**Auth:** None

### `GET /docs/:projectSlug/:versionSlug`

Version page. Redirects to the first document of the version, then FAQ/Troubleshooting if no documents exist, or to the changelog if no content exists.

**Auth:** None

### `GET /docs/:projectSlug/:versionSlug/:pageSlug`

Renders a documentation page with:
- Rendered Markdown content
- Sidebar navigation (page tree)
- Table of contents (extracted from headings)
- Previous/next page links
- Version switcher

**Auth:** None

### `GET /docs/:projectSlug/:versionSlug/changelog`

Renders the version's changelog (if published).

**Auth:** None

### `GET /docs/:projectSlug/_kb`

Redirects Non-Versioned projects to the first article section with content, falling back to `/docs/:projectSlug/_kb/faq`.

**Auth:** None

### `GET /docs/:projectSlug/_kb/:section`

Non-Versioned FAQ/Troubleshooting section page. `section` must be `faq` or `troubleshooting`.

**Auth:** None

### `GET /docs/:projectSlug/_kb/:section/:pageSlug`

Non-Versioned FAQ/Troubleshooting article page with rendered Markdown and table of contents.

**Auth:** None

### `GET /docs/:projectSlug/:versionSlug/_kb`

Redirects versioned projects to the first article section with content, falling back to `/docs/:projectSlug/:versionSlug/_kb/faq`.

**Auth:** None

### `GET /docs/:projectSlug/:versionSlug/_kb/:section`

Versioned article section page. `section` must be `faq` or `troubleshooting`.

**Auth:** None

### `GET /docs/:projectSlug/:versionSlug/_kb/:section/:pageSlug`

Versioned Knowledge Base article page with rendered Markdown and table of contents.

**Auth:** None

### `GET /api/search`

Full-text search across public Documents, FAQ, and Troubleshooting pages.

**Auth:** None

**Query:**

| Param | Type | Required | Constraints |
|-------|------|----------|-------------|
| `q` | string | Yes | Min 2 characters (after sanitization) |
| `project` | string | No | Project slug to scope search |
| `version` | string | No | Version ID to scope search |

**Response (JSON):**
```json
{
  "results": [
    {
      "id": "abc123def456789",
      "type": "page",
      "title": "Getting Started",
      "slug": "getting-started",
      "versionLabel": "v1.0",
      "versionSlug": "v1-0",
      "simpleMode": false,
      "href": "/docs/example/v1-0/getting-started"
    },
    {
      "id": "kb123def456789",
      "type": "article",
      "title": "Reset password",
      "slug": "reset-password",
      "section": "faq",
      "sectionLabel": "Frequently Asked Questions",
      "versionLabel": "v1.0",
      "versionSlug": "v1-0",
      "simpleMode": false,
      "href": "/docs/example/v1-0/_kb/faq/reset-password"
    }
  ]
}
```

---

## Rate Limits

| Scope | Window | Max Requests | Applies To |
|-------|--------|-------------|------------|
| General | 15 minutes | 100 (configurable) | Public home, documentation, and search routes |
| Auth | 15 minutes | 10 (configurable) | `/auth/*`, `/setup` |

Rate-limited responses return HTTP 429:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again later."
  }
}
```
