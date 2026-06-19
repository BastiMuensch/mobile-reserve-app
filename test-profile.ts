import { prisma } from './src/lib/prisma';
async function run() {
  const user = await prisma.user.findFirst({ where: { role: 'SCHULAMT' } });
  if (!user) return console.log('no schulamt user');
  let profile = await prisma.schulamtProfile.findUnique({ where: { userId: user.id } });
  if (!profile) {
    try {
      profile = await prisma.schulamtProfile.create({
        data: {
          userId: user.id,
          headerText: "Staatliche Schulämter im Landkreis Unterallgäu und in der Stadt Memmingen",
          returnAddress: "Staatliches Schulamt Unterallgäu - Memminger Str. 18 - 87719 Mindelheim",
          logoUrl: null,
          contactAddress: "Memminger Str. 18\n87719 Mindelheim\nTelefon 08261 995 341\nTelefax 08261 995 383",
          contactPerson: "Tamara Schmidt\nDurchwahl: 08261 995 441\nSchA\nschulamts@lra.unterallgaeu.de\nwww.schulamt.mm.unterallgaeu.de",
          city: "Mindelheim",
          amtsleitungName: "Ursula Abt",
          amtsleitungTitle: "Schulamtsdirektorin",
          signatureUrl: null
        }
      });
      console.log('created', profile);
    } catch(e) {
      console.log('error creating profile:', e);
    }
  } else {
    console.log('found', profile);
  }
}
run();
