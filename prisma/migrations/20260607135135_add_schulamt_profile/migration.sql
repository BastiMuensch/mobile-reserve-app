-- CreateTable
CREATE TABLE "SchulamtProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "headerText" TEXT NOT NULL DEFAULT 'Staatliche Schulämter im Landkreis Unterallgäu und in der Stadt Memmingen',
    "returnAddress" TEXT NOT NULL DEFAULT 'Staatliches Schulamt Unterallgäu - Kaiser-Max-Str. 1 - 87719 Mindelheim',
    "logoUrl" TEXT,
    "contactAddress" TEXT NOT NULL DEFAULT 'Memminger Str. 18
87719 Mindelheim
Telefon 08261 995 341
Telefax 08261 995 383',
    "contactPerson" TEXT NOT NULL DEFAULT 'Tamara Schmidt
Durchwahl: 08261 995 441
SchA
schulamts@lra.unterallgaeu.de
www.schulamt.mm.unterallgaeu.de',
    "city" TEXT NOT NULL DEFAULT 'Mindelheim',
    "amtsleitungName" TEXT NOT NULL DEFAULT 'Ursula Abt',
    "amtsleitungTitle" TEXT NOT NULL DEFAULT 'Schulamtsdirektorin',
    "signatureUrl" TEXT,

    CONSTRAINT "SchulamtProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchulamtProfile_userId_key" ON "SchulamtProfile"("userId");

-- AddForeignKey
ALTER TABLE "SchulamtProfile" ADD CONSTRAINT "SchulamtProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
