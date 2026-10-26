import { z } from 'zod';
import { ROLES } from '../enums.js';

export const LoginSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(256),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const TotpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type TotpCodeInput = z.infer<typeof TotpCodeSchema>;

export const LoginResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('OK') }),
  z.object({ status: z.literal('MFA_REQUIRED') }),
  z.object({
    status: z.literal('MFA_SETUP_REQUIRED'),
    otpauthUrl: z.string(),
    qrDataUrl: z.string(),
    secret: z.string(),
  }),
]);
export type LoginResult = z.infer<typeof LoginResultSchema>;

export const MeSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.enum(ROLES),
  regionId: z.string().nullable(),
  regionName: z.string().nullable(),
  institutionId: z.string().nullable(),
  institutionName: z.string().nullable(),
  bankId: z.string().nullable(),
  bankName: z.string().nullable(),
  mfaEnabled: z.boolean(),
  permissions: z.array(z.string()),
  demoMode: z.boolean(),
  today: z.string(),
});
export type Me = z.infer<typeof MeSchema>;
