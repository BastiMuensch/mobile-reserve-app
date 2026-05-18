# Mobile Reserve System - Project Context

Dieses Dokument dient als zentrale Wissensbasis ("Context") für zukünftige Entwicklungs-Sessions. Es fasst die Architektur, die Datenmodelle und die Kernfunktionen der **Mobile Reserve App** zusammen.

## 1. Projektübersicht
Die App ist eine Plattform für Schulämter (insb. in Bayern), um "Mobile Reserven" (Vertretungslehrkräfte) effizient zu verwalten und an Schulen zu vermitteln. 

**Zielgruppen / Rollen:**
- **ADMIN**: Super-Admin zur Verwaltung der Schulämter.
- **SCHULAMT**: Verwaltet Schulen, Lehrkräfte und weist Vertretungen zu.
- **SCHOOL**: Meldet Vertretungsbedarfe (Krankheit, Fortbildung etc.).
- **TEACHER**: Die Mobile Reserve selbst. Kann zugewiesene Einsätze einsehen, akzeptieren/ablehnen und die eigene Historie als Excel exportieren.

## 2. Tech Stack
- **Framework**: Next.js 16 (App Router)
- **Datenbank**: SQLite via Prisma ORM
- **Styling**: TailwindCSS, Shadcn-ähnliche UI-Komponenten, `lucide-react` für Icons
- **Auth**: `next-auth` (Credentials Provider mit bcrypt)
- **Mapping**: `react-leaflet` und `leaflet.markercluster` für die Kartenansicht
- **Exporte**: `xlsx` für Excel-Exporte
- **Mailing**: `nodemailer` für Benachrichtigungen an Schulämter

## 3. Architektur & UI
Das System läuft primär als "Single Page Application" (SPA) auf der Startseite (`src/app/page.tsx`). 
Nach dem Login (`LoginScreen.tsx`) wird je nach Rolle das entsprechende Dashboard gerendert:
- `AdminDashboard.tsx`
- `SchulamtDashboard.tsx` (größte Komponente mit Kartenansicht, Lehrkräfte- & Schulverwaltung, Archiv)
- `SchoolDashboard.tsx` (Bedarfsmeldung)
- `TeacherDashboard.tsx` (Übersicht der Einsätze)

## 4. Datenbank-Modelle (`prisma/schema.prisma`)
- **User**: Das Basis-Konto für den Login (`email`, `password`, `role`). Verknüpft mit `School` oder `Teacher`.
- **School**: Enthält Schuldaten (`name`, `address`, `latitude/longitude`, `type`).
- **Teacher**: Die Lehrkraft (`stammschuleId`, `maxWeeklyHours`, `qualifications`, `isPartTime`, `schedule`). Jede Lehrkraft gehört fest zu einer **Stammschule**.
- **Request**: Ein Vertretungsbedarf einer Schule (`date`, `endDate`, `hours`, `weeklyHours`, `schedule`, `priority`, `status`). 
- **Assignment**: Die tatsächliche Zuweisung einer Lehrkraft zu einem Request (`date`, `hours`, `status: PENDING | ACCEPTED | REJECTED`).

## 5. Aufbau einer Bedarfsmeldung (Request)
Schulen können verschiedene Arten von Anforderungen stellen:
- **Eintägig:** Die Schule meldet z.B. einen Bedarf für Dienstag ab der 1. Stunde (`date`, `startHour: 1`, `hours: 5`). Es wird kein `endDate` gesetzt.
- **Mehrtägig / Langfristig:** Wenn eine Lehrkraft länger ausfällt, wird ein Zeitraum (`date` bis `endDate`) angegeben. Optional kann hierfür im Backend ein `schedule` (JSON) hinterlegt werden, der definiert, an welchen Wochentagen wie viele Stunden benötigt werden (z.B. `{"1":[1,2,3], "2":[1,2]}` für Mo 1.-3. Std und Di 1.-2. Std). 
- Die Gesamtzahl der benötigten Stunden in dem Zeitraum wird in `weeklyHours` gespeichert, was wichtig für die Kapazitätsprüfung der Mobile Reserve ist.

Beim **Zuweisen (Assign)** im Schulamt-Dashboard öffnet sich ein Modal, in dem das Schulamt für jeden einzelnen Tag innerhalb des Bedarfs-Zeitraums exakt festlegen kann, wie viele Stunden die Lehrkraft an jenem Tag übernimmt. Dadurch können auch mehrere Teilzeit-Lehrkräfte auf denselben langfristigen Request gebucht werden.

## 6. Kernfunktionen & Besonderheiten
1. **Priorisiertes Matching (`/api/match`)**: Berechnet einen Match-Score für Lehrkräfte basierend auf:
   - **Stammschule (Prio 1):** Die Lehrkraft erhält einen massiven Boost (`+1000 Punkte`), wenn die anfragende Schule ihre eigene Stammschule (`stammschuleId === request.schoolId`) ist.
   - **Qualifikation (Prio 2):** Passen Schulart/Fach (z.B. Grundschule), gibt es einen starken Boost.
   - **Distanz:** Berechnet per Haversine-Formel zwischen Wohnort der Lehrkraft und Zielschule. Nähere Lehrkräfte werden (als Tie-Breaker) bevorzugt.
   - **Verfügbarkeit (Hard Filter):** Krankgemeldete Lehrkräfte oder Lehrkräfte, deren `maxWeeklyHours` (bzw. Teilzeit-Tagesplan im `schedule`) bereits aufgebraucht sind, werden komplett herausgefiltert.
2. **Geocoding**: Adressen von Lehrkräften und Schulen werden beim Anlegen über *OpenStreetMap Nominatim* im Backend automatisch in GPS-Koordinaten (Lat/Lng) umgewandelt.
3. **Schuljahres-Wechsel**: Das System filtert Daten primär nach dem aktiven Schuljahr (z.B. "2025/2026"). Im Schulamt-Dashboard können Lehrkräfte aus dem Vorjahr in das neue Schuljahr kopiert werden.
4. **Excel-Export**: Einsätze von Lehrkräften können im Schulamt-Dashboard sowie im Lehrer-Dashboard als vollständig formatierte `.xlsx`-Datei heruntergeladen werden.
5. **Auto-Refresh**: Das Schul- und Schulamt-Dashboard nutzen ein Custom-Event (`app-refresh`) oder Polling, um Daten in Echtzeit ohne Seiten-Reload aktuell zu halten.

## 7. Sicherheit (Security)
- Alle API-Routen in `src/app/api/` validieren zwingend das `userSession.role`.
- Prisma-Datenbankabfragen sind für Schulen (`SCHOOL`) und Schulämter (`SCHULAMT`) strikt auf die eigenen `schoolId` bzw. `schulamtId` limitiert (Data Isolation).
- Passwort-Hashes (`bcrypt`) werden niemals an den Client übergeben.

---
**Hinweis für die KI:** Lade dieses Dokument in deinen Kontext, bevor du komplexe Änderungen an der UI (insbesondere den Dashboards) oder der Datenbankstruktur planst.
