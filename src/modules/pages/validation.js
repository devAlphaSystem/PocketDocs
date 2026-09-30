import { z } from "zod";
import { SLUG_PATTERN, MAX_SLUG_LENGTH, MAX_TITLE_LENGTH, MAX_PAGE_TITLE_LENGTH, MAX_CONTENT_LENGTH, MARKDOWN_IMPORT, PAGE_SECTIONS, PAGE_ITEM_TYPES } from "../../config/constants.js";

const sectionSchema = z.enum([PAGE_SECTIONS.DOCUMENTS, PAGE_SECTIONS.FAQ, PAGE_SECTIONS.TROUBLESHOOTING]);
const collapsedByDefaultSchema = z
  .enum(["false", "true"])
  .default("false")
  .transform((value) => value === "true");

/** @type {import("zod").ZodObject} Validates page creation data including title, slug, and content. */
export const createPageSchema = z.object({
  section: sectionSchema.default(PAGE_SECTIONS.DOCUMENTS),
  title: z.string().trim().min(1, "Page title is required.").max(MAX_PAGE_TITLE_LENGTH, `Page title must be at most ${MAX_PAGE_TITLE_LENGTH} characters.`),
  slug: z.string().trim().min(1, "Slug is required.").max(MAX_SLUG_LENGTH).regex(SLUG_PATTERN, "Slug must contain only lowercase letters, numbers, and hyphens."),
  content: z.string().max(MAX_CONTENT_LENGTH).default(""),
  parent: z.string().max(15).optional().default(""),
  icon: z.string().max(50).optional().default(""),
});

/** @type {import("zod").ZodObject} Validates partial page update data. */
export const updatePageSchema = z.object({
  title: z.string().trim().min(1).max(MAX_PAGE_TITLE_LENGTH, `Page title must be at most ${MAX_PAGE_TITLE_LENGTH} characters.`).optional(),
  slug: z.string().trim().min(1).max(MAX_SLUG_LENGTH).regex(SLUG_PATTERN).optional(),
  content: z.string().max(MAX_CONTENT_LENGTH).optional(),
  parent: z.string().max(15).optional(),
  icon: z.string().max(50).optional(),
  order: z.coerce.number().int().min(0).optional(),
});

/** @type {import("zod").ZodObject} Validates a batch page reorder request. */
export const reorderPagesSchema = z.object({
  pages: z
    .array(
      z.object({
        id: z.string().min(1).max(15),
        order: z.number().int().min(0),
        parent: z.string().max(15).default(""),
      }),
    )
    .min(1),
});

/** @type {import("zod").ZodObject} Validates selected content and sidebar items submitted for batch deletion. */
export const deletePagesSchema = z.object({
  pageIds: z
    .preprocess(
      (value) => {
        if (Array.isArray(value)) return value;
        return value ? [value] : [];
      },
      z.array(z.string().min(1).max(15)).min(1, "Select at least one item to remove.").max(100),
    )
    .transform((pageIds) => [...new Set(pageIds)]),
});

/** @type {import("zod").ZodObject} Validates a sidebar header or separator creation request. */
export const createSidebarItemSchema = z
  .object({
    itemType: z.enum([PAGE_ITEM_TYPES.HEADER, PAGE_ITEM_TYPES.SEPARATOR]),
    title: z.string().trim().max(MAX_TITLE_LENGTH).optional().default(""),
    collapsed_by_default: collapsedByDefaultSchema,
  })
  .superRefine((data, ctx) => {
    if (data.itemType === PAGE_ITEM_TYPES.HEADER && !data.title) {
      ctx.addIssue({
        code: "custom",
        path: ["title"],
        message: "Header title is required.",
      });
    }
  });

/** @type {import("zod").ZodObject} Validates a sidebar header update request. */
export const updateSidebarHeaderSchema = z.object({
  title: z.string().trim().min(1, "Header title is required.").max(MAX_TITLE_LENGTH),
  collapsed_by_default: collapsedByDefaultSchema,
});

/** @type {import("zod").ZodObject} Validates bulk Markdown page import payloads. */
export const importMarkdownPagesSchema = z
  .object({
    files: z
      .array(
        z.object({
          filename: z.string().trim().min(1, "Markdown filename is required.").max(500, "Markdown filename is too long."),
          content: z.string().max(MAX_CONTENT_LENGTH, "Markdown file content is too large."),
        }),
      )
      .min(1, "Select at least one Markdown file to import."),
  })
  .superRefine((data, ctx) => {
    const totalLength = data.files.reduce((sum, file) => sum + file.content.length, 0);
    if (totalLength > MARKDOWN_IMPORT.MAX_TOTAL_CONTENT_LENGTH) {
      ctx.addIssue({
        code: "custom",
        path: ["files"],
        message: `Markdown import content is larger than ${MARKDOWN_IMPORT.MAX_TOTAL_CONTENT_LENGTH} characters.`,
      });
    }
  });
