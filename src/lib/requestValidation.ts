import { z } from 'zod';
import { parseDateKeyStrict, inclusiveCalendarDaysBetween, toLocalDateInputValue } from './dateKey';

/**
 * Erlaubte Prioritäten für Bedarfe.
 */
export const ALLOWED_PRIORITIES = ['UNPLANNED_ABSENCE', 'FORTBILDUNG', 'SCHULINTERN'] as const;
export type RequestPriority = typeof ALLOWED_PRIORITIES[number];

const VALID_WEEKDAYS = new Set(['1', '2', '3', '4', '5']);

/**
 * Stundenplan-Schema für mehrwöchige oder offene Bedarfe:
 * Schlüssel sind Wochentage ('1' = Montag bis '5' = Freitag).
 * Werte sind Arrays von Unterrichtsstunden (ganze Zahlen 1 bis 10, ohne Duplikate).
 */
export const TimetableScheduleSchema = z.record(
  z.string(),
  z.array(z.number().int().min(1).max(10))
    .refine(hours => new Set(hours).size === hours.length, {
      message: 'Unterrichtsstunden an einem Tag müssen eindeutig sein.',
    })
)
.refine(schedule => Object.keys(schedule).every(k => VALID_WEEKDAYS.has(k)), {
  message: 'Wochentage im Stundenplan dürfen nur 1 (Mo) bis 5 (Fr) sein.',
})
.refine(schedule => {
  const totalHours = Object.values(schedule).reduce((sum, h) => sum + h.length, 0);
  return totalHours > 0;
}, {
  message: 'Der Stundenplan muss mindestens eine Unterrichtsstunde enthalten.',
});

export type TimetableSchedule = Record<string, number[]>;

export function getScheduleHourTotals(schedule: TimetableSchedule): { dailyMaximum: number; weeklyTotal: number } {
  const dayLengths = Object.values(schedule).map(hours => hours.length);
  return {
    dailyMaximum: Math.max(0, ...dayLengths),
    weeklyTotal: dayLengths.reduce((sum, hours) => sum + hours, 0),
  };
}

/**
 * Hilfsfunktion zum Parsen und Validieren eines Stundenplan-Strings oder -Objekts.
 */
export function parseTimetableSchedule(scheduleRaw: unknown): TimetableSchedule | null {
  if (!scheduleRaw) return null;
  let parsedJson = scheduleRaw;
  if (typeof scheduleRaw === 'string') {
    try {
      parsedJson = JSON.parse(scheduleRaw);
    } catch {
      throw new Error('Stundenplan ist kein gültiges JSON.');
    }
  }
  const result = TimetableScheduleSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message || 'Ungültiger Stundenplan.');
  }
  return result.data;
}

/**
 * Wiederverwendbares Zod-Schema für neue Anforderungen (Bedarfe).
 *
 * Beachtet alle Leitplanken aus dem Audit:
 * - Keine beliebigen Prioritäten oder Fantasiedaten
 * - Strikte Stundenbegrenzung (1-10)
 * - Feste Zeiträume auf maximal 400 Tage begrenzt
 * - "Bis auf Weiteres" nur bei UNPLANNED_ABSENCE mit gültigem Stundenplan und ohne Enddatum
 * - Textlängenbegrenzungen
 */
export function createRequestSchema(todayKey: string = toLocalDateInputValue()) {
  return z.object({
  schoolId: z.string().uuid('Ungültige Schul-ID'),
  date: z.string().refine(val => {
    try {
      parseDateKeyStrict(val);
      return true;
    } catch {
      return false;
    }
  }, { message: 'Ungültiges Startdatum (erwartet wird ein reales Kalenderdatum YYYY-MM-DD).' }),
  endDate: z.string().nullable().optional().refine(val => {
    if (!val) return true;
    try {
      parseDateKeyStrict(val);
      return true;
    } catch {
      return false;
    }
  }, { message: 'Ungültiges Enddatum (erwartet wird ein reales Kalenderdatum YYYY-MM-DD).' }),
  priority: z.enum(ALLOWED_PRIORITIES, {
    message: 'Ungültige Priorität. Erlaubt sind nur: UNPLANNED_ABSENCE, FORTBILDUNG, SCHULINTERN.',
  }).default('UNPLANNED_ABSENCE'),
  startHour: z.coerce.number().int().min(1).max(10, 'Startstunde muss zwischen 1 und 10 liegen.'),
  hours: z.coerce.number().int().min(1).max(10, 'Stundenzahl pro Tag muss zwischen 1 und 10 liegen.').optional(),
  weeklyHours: z.coerce.number().int().min(1).max(50, 'Wochenstunden müssen zwischen 1 und 50 liegen.').optional(),
  substitutedTeacher: z.string().trim().min(1, 'Bitte geben Sie den Namen der vertretenen Lehrkraft an.').max(200, 'Name darf höchstens 200 Zeichen lang sein.'),
  schedule: z.union([z.string(), z.record(z.string(), z.any())]).nullable().optional(),
  qualifications: z.string().max(500, 'Qualifikationen dürfen höchstens 500 Zeichen umfassen.').default(''),
  comments: z.string().trim().min(1, 'Kommentarfeld (Startzeit/Parken) ist Pflicht.').max(2000, 'Kommentar darf höchstens 2000 Zeichen lang sein.'),
  isOpenEnded: z.boolean().default(false),
  }).superRefine((data, ctx) => {
  // Die Oberfläche prüft das ebenfalls, der Server darf sich darauf aber nicht verlassen.
  if (data.date < todayKey) {
    ctx.addIssue({
      code: 'custom',
      path: ['date'],
      message: 'Das Startdatum darf nicht in der Vergangenheit liegen.',
    });
  }

  // 1. Validierung des Zeitraums
  if (data.isOpenEnded) {
    if (data.priority !== 'UNPLANNED_ABSENCE') {
      ctx.addIssue({
        code: 'custom',
        path: ['isOpenEnded'],
        message: 'Ein Bedarf ohne festes Ende ist nur bei einem ungeplanten Ausfall (UNPLANNED_ABSENCE) zulässig.',
      });
    }
    if (data.endDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Ein offener Bedarf („bis auf Weiteres“) darf kein Enddatum haben.',
      });
    }
    if (!data.schedule) {
      ctx.addIssue({
        code: 'custom',
        path: ['schedule'],
        message: 'Ein offener Bedarf („bis auf Weiteres“) erfordert zwingend einen gültigen Stundenplan.',
      });
    }
  } else {
    // Fester Zeitraum
    if (data.schedule && !data.endDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Ein Bedarf mit Wochenstundenplan benötigt ein Enddatum oder muss als „bis auf Weiteres“ markiert sein.',
      });
    }
    if (data.endDate && data.endDate !== data.date && !data.schedule) {
      ctx.addIssue({
        code: 'custom',
        path: ['schedule'],
        message: 'Ein mehrtägiger Bedarf benötigt einen gültigen Wochenstundenplan.',
      });
    }
    if (data.endDate) {
      try {
        const days = inclusiveCalendarDaysBetween(data.date, data.endDate);
        if (days > 400) {
          ctx.addIssue({
            code: 'custom',
            path: ['endDate'],
            message: `Der Zeitraum überschreitet das Maximum von 400 Kalendertagen (${days} Tage angegeben).`,
          });
        }
      } catch (err: unknown) {
        ctx.addIssue({
          code: 'custom',
          path: ['endDate'],
          message: err instanceof Error ? err.message : 'Ungültiger Zeitraum.',
        });
      }
    }
  }

  // 2. Stundenplan validieren, falls vorhanden
  if (data.schedule) {
    try {
      const normalizedSchedule = parseTimetableSchedule(data.schedule);
      if (normalizedSchedule) {
        const totals = getScheduleHourTotals(normalizedSchedule);
        if (data.hours !== undefined && data.hours !== totals.dailyMaximum) {
          ctx.addIssue({
            code: 'custom',
            path: ['hours'],
            message: 'Die tägliche Stundenzahl stimmt nicht mit dem Wochenstundenplan überein.',
          });
        }
        if (data.weeklyHours !== undefined && data.weeklyHours !== totals.weeklyTotal) {
          ctx.addIssue({
            code: 'custom',
            path: ['weeklyHours'],
            message: 'Die Wochenstundenzahl stimmt nicht mit dem Wochenstundenplan überein.',
          });
        }
      }
    } catch (e: unknown) {
      ctx.addIssue({
        code: 'custom',
        path: ['schedule'],
        message: e instanceof Error ? e.message : 'Ungültiger Stundenplan.',
      });
    }
  } else if (!data.hours) {
    ctx.addIssue({
      code: 'custom',
      path: ['hours'],
      message: 'Bitte geben Sie die Stundenzahl pro Tag an, wenn kein Stundenplan hinterlegt ist.',
    });
  } else {
    if (data.startHour + data.hours - 1 > 10) {
      ctx.addIssue({
        code: 'custom',
        path: ['hours'],
        message: 'Startstunde und Dauer dürfen nicht über die 10. Unterrichtsstunde hinausreichen.',
      });
    }
    if (data.weeklyHours !== undefined && data.weeklyHours !== data.hours) {
      ctx.addIssue({
        code: 'custom',
        path: ['weeklyHours'],
        message: 'Bei einem eintägigen Bedarf müssen Wochenstunden und Tagesstunden übereinstimmen.',
      });
    }
  }
  });
}

export const CreateRequestSchema = createRequestSchema();

export type CreateRequestInput = z.infer<typeof CreateRequestSchema>;
