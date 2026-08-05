-- Krankmeldung "bis auf Weiteres": Die Schule kennt das Ende einer Erkrankung nicht.
-- Der Bedarf läuft weiter und wird über einen rollierenden Horizont besetzt, bis die
-- Schule die Rückkehr meldet (dann wird endDate gesetzt und isOpenEnded zurückgenommen).
--
-- Bewusst ein eigenes Kennzeichen statt "endDate IS NULL": Bei Request bedeutet ein
-- leeres endDate im gesamten Code "genau ein Tag" – eine Umdeutung hätte die
-- Tageszerlegung, das Matching, die Dringlichkeit und die Archivierung gleichzeitig
-- gebrochen.
ALTER TABLE "Request" ADD COLUMN "isOpenEnded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Request" ADD COLUMN "endedAt" TIMESTAMP(3);
