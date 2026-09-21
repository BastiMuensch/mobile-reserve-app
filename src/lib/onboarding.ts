import { z } from "zod";
import { SCHOOL_TYPES } from "./schoolTypes";

export const BAYTGV_LEGAL_TEXT = [
  "Umzugskostenvergütung wird nicht zugesagt.",
  "Bei einer Abordnung an einen Ort außerhalb des Dienst- oder Wohnortes ohne Zusage der Umzugskostenvergütung erhalten Sie auf Antrag Trennungsgeld (Entschädigung bei täglicher Rückkehr zum Wohnort) nach der BayTGV (Art. 22 Abs. 1 BayRKG i. V. m. § 1 Abs. 1 Nr. 3 BayTGV).",
  "Einem etwaigen Antrag auf Trennungsgeld ist dieses Abordnungsschreiben (ggf. Ablichtung) beizufügen.",
].join("\n\n");

const optionalUploadPath = z
  .string()
  .trim()
  .regex(/^\/uploads\/[a-f0-9-]+\.(png|jpe?g)$/i)
  .optional()
  .nullable()
  .or(z.literal(""));

const optionalSignaturePath = z
  .string()
  .trim()
  .regex(/^\/api\/media\/[a-f0-9-]+\.(png|jpe?g)$/i)
  .optional()
  .nullable()
  .or(z.literal(""));

export const onboardingProfileSchema = z
  .object({
    headerText: z.string().trim().min(1, "Der Briefkopf ist erforderlich.").max(500),
    returnAddress: z.string().trim().min(1, "Die Rücksendezeile ist erforderlich.").max(500),
    contactAddress: z.string().trim().min(1, "Die Kontaktanschrift ist erforderlich.").max(1000),
    contactPerson: z.string().trim().min(1, "Eine Ansprechperson ist erforderlich.").max(1000),
    city: z.string().trim().min(1, "Der Ort ist erforderlich.").max(120),
    amtsleitungName: z.string().trim().min(1, "Der Name der Amtsleitung ist erforderlich.").max(200),
    amtsleitungTitle: z.string().trim().min(1, "Die Funktion der Amtsleitung ist erforderlich.").max(200),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    logoUrl: optionalUploadPath,
    signatureUrl: optionalSignaturePath,
    documentSubject: z.string().trim().min(1, "Der Betreff ist erforderlich.").max(300),
    documentIntro: z.string().trim().min(1, "Die Einleitung ist erforderlich.").max(1000),
    documentClosing: z.string().trim().min(1, "Die Schlussformel ist erforderlich.").max(300),
    mailProvider: z.enum(["NONE", "SMTP"]).default("NONE"),
    smtpHost: z.string().trim().max(255).optional().default(""),
    smtpPort: z.coerce.number().int().min(1).max(65535).optional().default(587),
    smtpSecure: z.boolean().optional().default(false),
    smtpUser: z.string().trim().max(320).optional().default(""),
    smtpPass: z.string().max(1000).optional().default(""),
    smtpFromName: z.string().trim().max(200).optional().default(""),
    smtpFromAddress: z.string().trim().max(320).optional().default(""),
    teacherInviteValidityDays: z.coerce.number().int().min(1).max(90).default(14),
  })
  .superRefine((profile, ctx) => {
    if ((profile.latitude == null) !== (profile.longitude == null)) {
      ctx.addIssue({ code: "custom", path: ["latitude"], message: "Breiten- und Längengrad müssen gemeinsam angegeben werden." });
    }
    if (profile.mailProvider !== "SMTP") return;

    const requiredFields: Array<[keyof typeof profile, string]> = [
      ["smtpHost", "SMTP-Host ist erforderlich."],
      ["smtpUser", "SMTP-Benutzer ist erforderlich."],
      ["smtpPass", "SMTP-Passwort ist erforderlich."],
      ["smtpFromName", "Absendername ist erforderlich."],
      ["smtpFromAddress", "Absender-E-Mail ist erforderlich."],
    ];
    for (const [field, message] of requiredFields) {
      if (!profile[field]) ctx.addIssue({ code: "custom", path: [field], message });
    }
    if (profile.smtpFromAddress && !z.email().safeParse(profile.smtpFromAddress).success) {
      ctx.addIssue({ code: "custom", path: ["smtpFromAddress"], message: "Ungültige Absender-E-Mail." });
    }
  });

export const onboardingSchoolSchema = z
  .object({
    name: z.string().trim().min(1, "Der Schulname ist erforderlich.").max(200),
    address: z.string().trim().min(1, "Die Schuladresse ist erforderlich.").max(500),
    type: z.enum(SCHOOL_TYPES),
    email: z.string().trim().email("Ungültige Schul-E-Mail."),
    password: z.string().min(12, "Schulpasswörter müssen mindestens 12 Zeichen lang sein.").max(200),
    isSmall: z.boolean().default(false),
    latitude: z.number().min(-90).max(90).optional().nullable(),
    longitude: z.number().min(-180).max(180).optional().nullable(),
    geocodingStatus: z.enum(["PENDING", "RESOLVED", "NOT_FOUND", "UNAVAILABLE", "MANUAL"]).optional(),
  })
  .superRefine((school, ctx) => {
    if ((school.latitude == null) !== (school.longitude == null)) {
      ctx.addIssue({ code: "custom", path: ["latitude"], message: "Breiten- und Längengrad müssen gemeinsam angegeben werden." });
    }
  });

export const schulamtOnboardingSchema = z
  .object({
    name: z.string().trim().min(1, "Die Bezeichnung des Schulamts ist erforderlich.").max(200),
    email: z.string().trim().email("Ungültige Schulamts-E-Mail."),
    password: z.string().min(12, "Das Passwort muss mindestens 12 Zeichen lang sein.").max(200),
    setupToken: z.string().optional(),
    // Optional for backwards-compatible setup clients. Empty legal texts are
    // intentionally allowed: their factual/legal approval remains with the
    // responsible school authority and can be completed in settings later.
    publicSettings: z.object({
      supportContact: z.string().trim().max(1000).optional().default(""),
      impressum: z.string().trim().max(12_000).optional().default(""),
      privacyPolicy: z.string().trim().max(12_000).optional().default(""),
    }).optional(),
    profile: onboardingProfileSchema,
    schools: z.array(onboardingSchoolSchema).min(1, "Mindestens eine Schule ist erforderlich.").max(100),
  })
  .superRefine((value, ctx) => {
    const emails = [value.email, ...value.schools.map((school) => school.email)]
      .map((email) => email.trim().toLowerCase());
    if (new Set(emails).size !== emails.length) {
      ctx.addIssue({ code: "custom", path: ["schools"], message: "Alle Login-E-Mail-Adressen müssen eindeutig sein." });
    }
  });

export type SchulamtOnboardingInput = z.infer<typeof schulamtOnboardingSchema>;
