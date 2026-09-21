import { z } from 'zod';

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url('Ungültige Endpunkt-URL.').max(1000, 'Endpunkt-URL zu lang.'),
  keys: z.object({
    p256dh: z.string().min(1, 'p256dh Key erforderlich.').max(255, 'p256dh Key zu lang.'),
    auth: z.string().min(1, 'auth Key erforderlich.').max(255, 'auth Key zu lang.'),
  }),
});
