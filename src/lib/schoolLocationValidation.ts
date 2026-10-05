import { z } from 'zod';
import { validateSchoolNavigationPoints } from './schoolNavigation';

export const SchoolLocationFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Bitte benennen Sie die Außenstelle.').max(120),
  address: z.string().trim().min(1, 'Bitte geben Sie die Adresse an.').max(500),
  latitude: z.number().finite().min(-90).max(90).nullable().default(null),
  longitude: z.number().finite().min(-180).max(180).nullable().default(null),
  generalInfo: z.string().trim().max(2000).nullable().default(null),
  imageUrl: z.string().max(500).regex(/^\/uploads\/[a-zA-Z0-9._-]+$/, 'Ungültige Bild-URL.').nullable().default(null),
  entranceLat: z.number().finite().min(-90).max(90).nullable().default(null),
  entranceLng: z.number().finite().min(-180).max(180).nullable().default(null),
  parkingLat: z.number().finite().min(-90).max(90).nullable().default(null),
  parkingLng: z.number().finite().min(-180).max(180).nullable().default(null),
  isActive: z.boolean().default(true),
});

export const SchoolLocationSchema = SchoolLocationFieldsSchema.extend({
  id: z.string().uuid().optional(),
  schoolId: z.string().uuid(),
}).superRefine((location, ctx) => {
  if ((location.latitude == null) !== (location.longitude == null)) {
    ctx.addIssue({ code: 'custom', message: 'Standort-Koordinaten müssen paarweise angegeben werden.', path: ['latitude'] });
  }
  const error = validateSchoolNavigationPoints(location);
  if (error) ctx.addIssue({ code: 'custom', message: error, path: ['entranceLat'] });
});
