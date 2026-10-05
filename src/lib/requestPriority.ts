/** Available reasons, in the order agreed with the school authority. */
export const ALLOWED_PRIORITIES = ['UNPLANNED_ABSENCE', 'DIENSTBEFREIUNG', 'FORTBILDUNG', 'OTHER'] as const;
export type RequestPriority = typeof ALLOWED_PRIORITIES[number];

export const REQUEST_PRIORITY_OPTIONS = [
  { value: 'UNPLANNED_ABSENCE', label: 'Ungeplanter Ausfall', rank: 1 },
  { value: 'DIENSTBEFREIUNG', label: 'Dienstbefreiung / Freistellung vom Dienst', rank: 2 },
  { value: 'FORTBILDUNG', label: 'Fortbildung', rank: 3 },
  { value: 'OTHER', label: 'Weitere Gründe', rank: 4 },
] as const;

/** Historic reasons remain readable, but cannot be selected for new requests. */
export function requestPriorityLabel(priority?: string | null): string {
  const option = REQUEST_PRIORITY_OPTIONS.find(option => option.value === priority);
  if (option) return option.label;
  if (priority === 'SCHULINTERN') return 'Schulintern geblockt (früherer Grund)';
  if (priority === 'MUTTERSCHUTZ') return 'Geplanter Ausfall (früherer Grund)';
  return priority || REQUEST_PRIORITY_OPTIONS[0].label;
}

/** Keep historic requests visible under further reasons without rewriting them. */
export function requestPriorityCategory(priority?: string | null): RequestPriority {
  if (!priority) return 'UNPLANNED_ABSENCE';
  return ALLOWED_PRIORITIES.includes(priority as RequestPriority) ? priority as RequestPriority : 'OTHER';
}
