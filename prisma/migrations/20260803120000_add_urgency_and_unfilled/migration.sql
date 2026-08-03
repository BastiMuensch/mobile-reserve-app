-- Gewichtung von Bedarfen: kleine Schulen und Häufungen (z.B. Magen-Darm-Welle)
-- werden dringlicher eingestuft, siehe src/lib/urgency.ts.
ALTER TABLE "School" ADD COLUMN "isSmall" BOOLEAN NOT NULL DEFAULT false;
-- Beide Übersteuerungen sind befristet, damit eine einmalige Abwahl die automatische
-- Erkennung nicht dauerhaft stummschaltet.
ALTER TABLE "School" ADD COLUMN "outbreakUntil" TIMESTAMP(3);
ALTER TABLE "School" ADD COLUMN "outbreakDismissedUntil" TIMESTAMP(3);

-- Absage: das Schulamt konnte keine Mobile Reserve stellen. Der Status wandert in
-- Request.status auf "UNFILLED"; Begründung und Zeitpunkt werden mitgeführt, damit die
-- Schule nachvollziehen kann, warum – und damit die Absage zurückgenommen werden kann.
ALTER TABLE "Request" ADD COLUMN "unfilledReason" TEXT;
ALTER TABLE "Request" ADD COLUMN "unfilledAt" TIMESTAMP(3);
