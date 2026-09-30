import { z } from "zod";

/** @type {import("zod").ZodObject} Validates login form data with email and password. */
export const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email address.").max(255),
  password: z.string().min(8, "Password must be at least 8 characters.").max(256),
});

/** @type {import("zod").ZodEffects} Validates registration form data with password confirmation. */
export const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100),
    email: z.string().trim().email("Please enter a valid email address.").max(255),
    password: z.string().min(8, "Password must be at least 8 characters.").max(256),
    passwordConfirm: z.string().min(8).max(256),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    message: "Passwords do not match.",
    path: ["passwordConfirm"],
  });
