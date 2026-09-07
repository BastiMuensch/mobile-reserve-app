import { z } from "zod";

// Keep this tiny validation primitive here rather than importing the geocoding
// module: that module is intentionally server-only and this schema has unit tests.
const postalCodeSchema = z.string().trim().regex(/^\d{5}$/, "Bitte geben Sie eine fünfstellige Postleitzahl ein.");

/** Fields a teacher may change for their own contact and approximate home position. */
export const teacherSelfProfileSchema = z.object({
  address: z.string().trim().min(5, "Bitte geben Sie Ihre vollständige postalische Anschrift an.").max(500),
  postalCode: postalCodeSchema,
  // The client already sends numeric confirmed coordinates. Do not coerce here:
  // null and an empty field must not silently become the valid coordinate 0.
  homeLat: z.number().finite().min(-90).max(90),
  homeLng: z.number().finite().min(-180).max(180),
  phone: z.string().trim().max(80).optional().default(""),
}).strict();

export type TeacherSelfProfile = z.infer<typeof teacherSelfProfileSchema>;
