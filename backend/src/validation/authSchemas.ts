import { z } from 'zod';

// Signup / claim request body. Kept in its own dependency-free module so unit
// tests can exercise the validation rules without importing the controller
// (which drags in prisma, email, and env side effects).
//
// `username` is optional since 1.0.17: signup is email+password only. When
// omitted, a claimed guest keeps their existing user####### handle and a
// direct signup gets one generated server-side. Users can rename later in
// Edit Profile.
export const signupSchema = z.object({
  firstName: z.string().max(50).optional(),
  lastName: z.string().max(50).optional(),
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Username may only contain letters, numbers, and underscores')
    .optional(),
  email: z.string().email(),
  password: z
    .string()
    .min(8)
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
  // Optional referral code (someone invited this user). Captured at signup/claim
  // and rewarded at email verification. Loosely validated here; resolved +
  // normalized server-side (unknown codes are ignored, never an error).
  referralCode: z.string().max(20).optional(),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
