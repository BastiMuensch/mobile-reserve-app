import { prisma } from './prisma';

// Server-only setting, deliberately absent from the editable settings whitelist.
export async function isDemoMode() {
  if (process.env.DEMO_MODE === 'true') return true;
  return (await prisma.systemSetting.findUnique({ where: { id: 'demoMode' } }))?.value === 'true';
}
