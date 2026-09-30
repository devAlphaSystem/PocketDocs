import { z } from "zod";

/** @type {import("zod").ZodEffects} Validates user creation data with password confirmation and role. */
export const createUserSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100),
    email: z.string().trim().email("Please enter a valid email address.").max(255),
    password: z.string().min(8, "Password must be at least 8 characters.").max(256),
    passwordConfirm: z.string().min(8).max(256),
    role: z.enum(["admin", "editor"], { message: "Invalid role." }),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Passwords do not match.",
    path: ["passwordConfirm"],
  });

/** @type {import("zod").ZodEffects} Validates user update data with optional password change. */
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100),
    email: z.string().trim().email("Please enter a valid email address.").max(255),
    role: z.enum(["admin", "editor"], { message: "Invalid role." }),
    password: z.string().max(256).optional().default(""),
    passwordConfirm: z.string().max(256).optional().default(""),
  })
  .refine(
    (data) => {
      if (data.password && data.password.length > 0) {
        return data.password.length >= 8;
      }
      return true;
    },
    { message: "Password must be at least 8 characters.", path: ["password"] },
  )
  .refine(
    (data) => {
      if (data.password && data.password.length > 0) {
        return data.password === data.passwordConfirm;
      }
      return true;
    },
    { message: "Passwords do not match.", path: ["passwordConfirm"] },
  );
