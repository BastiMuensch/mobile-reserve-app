/**
 * Server-side emergency recovery for the one Schulamt account of an instance.
 * This is deliberately not exposed through HTTP and requires an interactive TTY.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import readline from 'node:readline/promises';

const CONFIRMATION = 'SCHULAMT-KONTO-WIEDERHERSTELLEN';
const prisma = new PrismaClient();

function fail(message) {
  throw new Error(message);
}

async function askConfirmation() {
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await terminal.question(`Zum Fortfahren exakt „${CONFIRMATION}“ eingeben: `);
  } finally {
    terminal.close();
  }
}

async function askHiddenPassword(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail('Die Wiederherstellung benötigt ein interaktives Terminal; Passwörter werden nicht über Argumente oder Umgebungsvariablen akzeptiert.');
  }

  process.stdout.write(prompt);
  return await new Promise((resolve, reject) => {
    let value = '';
    const input = process.stdin;
    const previouslyRaw = input.isRaw;

    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(previouslyRaw);
      input.pause();
    };
    const abort = (message) => {
      cleanup();
      process.stdout.write('\n');
      reject(new Error(message));
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') return abort('Abgebrochen.');
        if (character === '\r' || character === '\n') {
          cleanup();
          process.stdout.write('\n');
          return resolve(value);
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= ' ') value += character;
      }
    };

    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail('Die Wiederherstellung darf nur in einem interaktiven Terminal ausgeführt werden.');
  }

  const schulaemter = await prisma.user.findMany({
    where: { role: 'SCHULAMT' },
    select: { id: true, email: true, isActive: true },
    take: 2,
  });
  if (schulaemter.length !== 1) {
    fail(`Wiederherstellung verweigert: Erwartet wird genau ein Schulamtskonto, gefunden wurden ${schulaemter.length}. Bitte die Altdaten zuerst fachlich prüfen; dieses Skript trifft keine Auswahl.`);
  }

  const schulamt = schulaemter[0];
  console.log(`Ausgewähltes Schulamtskonto: ${schulamt.email} (${schulamt.isActive ? 'aktiv' : 'deaktiviert'})`);
  const confirmation = await askConfirmation();
  if (confirmation !== CONFIRMATION) fail('Bestätigungsphrase stimmt nicht überein. Es wurden keine Daten geändert.');

  const password = await askHiddenPassword('Neues Passwort (mindestens 12 Zeichen, Eingabe bleibt unsichtbar): ');
  if (password.length < 12) fail('Passwort muss mindestens 12 Zeichen lang sein. Es wurden keine Daten geändert.');
  const passwordRepeat = await askHiddenPassword('Neues Passwort wiederholen: ');
  if (password !== passwordRepeat) fail('Passwörter stimmen nicht überein. Es wurden keine Daten geändert.');

  await prisma.user.update({
    where: { id: schulamt.id },
    data: {
      password: await bcrypt.hash(password, 12),
      isActive: true,
      sessionVersion: { increment: 1 },
    },
  });
  console.log('Schulamtskonto wiederhergestellt. Alle bisherigen Sitzungen dieses Kontos wurden abgemeldet.');
}

try {
  await main();
} catch (error) {
  console.error(`Wiederherstellung nicht ausgeführt: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
