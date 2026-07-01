import { z } from 'zod';

// Validation for the admin "create user" form. Kept dependency-free so it can be
// unit-tested without the route.
//
// The email rule is the important part: the admin endpoint previously did NO
// format validation, so a malformed address (e.g. "mazie@dailywokester" with no
// TLD) saved silently — and then login and forgot-password, which DO require a
// valid email, could never match it. We require both zod's .email() AND an
// explicit TLD (`.xx`) so a missing domain suffix is rejected at creation
// regardless of how lenient a given zod version's .email() is.
//
// Password complexity is intentionally NOT enforced here: admins create test
// accounts with simple passwords on purpose. Only a non-empty password is
// required.
export const adminCreateUserSchema = z.object({
  firstName: z.string().trim().max(50).optional(),
  lastName: z.string().trim().max(50).optional(),
  username: z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be at most 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores'),
  email: z
    .string()
    .trim()
    .email('Enter a valid email address')
    .refine(
      (e) => /\.[a-zA-Z]{2,}$/.test(e),
      'Email must include a domain (e.g. name@example.com)',
    ),
  password: z.string().min(1, 'Password is required'),
});

export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;

// Flatten a failed parse into a single human-readable message for the dashboard
// (which renders a plain string, not the nested zod error object).
export function firstZodError(error: z.ZodError): string {
  const { formErrors, fieldErrors } = error.flatten();
  for (const errs of Object.values(fieldErrors)) {
    if (errs && errs.length > 0) return errs[0] as string;
  }
  return formErrors[0] ?? 'Invalid input';
}
