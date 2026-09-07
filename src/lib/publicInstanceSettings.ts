import { z } from "zod";

export const PUBLIC_INSTANCE_SETTING_IDS = [
  "publicInstanceName",
  "publicSupportContact",
  "impressum",
  "privacyPolicy",
  "loginLogoUrl",
  "loginLogoAlt",
] as const;

export type PublicInstanceSettingId = (typeof PUBLIC_INSTANCE_SETTING_IDS)[number];

const optionalText = (max: number) => z.string().trim().max(max).default("");
const localLoginLogoPattern = /^\/uploads\/[a-f0-9-]+\.(png|jpe?g)$/i;

export function isLocalLoginLogoUrl(value: string): boolean {
  return localLoginLogoPattern.test(value);
}

// Public login branding must remain a local, verified upload. In particular this
// deliberately excludes absolute URLs and data URLs from a public render path.
export const publicInstanceSettingsSchema = z.object({
  publicInstanceName: z.string().trim().min(1, "Der öffentliche Instanzname ist erforderlich.").max(200),
  publicSupportContact: optionalText(1000),
  impressum: optionalText(12_000),
  privacyPolicy: optionalText(12_000),
  loginLogoUrl: z.string().trim().refine((value) => !value || isLocalLoginLogoUrl(value), "Bitte wählen Sie ein hochgeladenes PNG- oder JPEG-Logo.").default(""),
  loginLogoAlt: optionalText(200),
}).strict();

export type PublicInstanceSettings = z.infer<typeof publicInstanceSettingsSchema>;

export const emptyPublicInstanceSettings: PublicInstanceSettings = {
  publicInstanceName: "",
  publicSupportContact: "",
  impressum: "",
  privacyPolicy: "",
  loginLogoUrl: "",
  loginLogoAlt: "",
};

export function settingsFromRecords(records: Array<{ id: string; value: string }>): PublicInstanceSettings {
  const values = new Map(records.map((record) => [record.id, record.value]));
  return {
    publicInstanceName: values.get("publicInstanceName") || "",
    publicSupportContact: values.get("publicSupportContact") || "",
    impressum: values.get("impressum") || "",
    privacyPolicy: values.get("privacyPolicy") || "",
    loginLogoUrl: values.get("loginLogoUrl") || "",
    loginLogoAlt: values.get("loginLogoAlt") || "",
  };
}
