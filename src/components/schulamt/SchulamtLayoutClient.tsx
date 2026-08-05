"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, Users, BarChart3, Settings, Wand2, School, FolderArchive } from "lucide-react";
import { useSchulamtData } from "@/hooks/useSchulamtData";
import { SchulamtYearProvider, useSchulamtYear } from "@/hooks/useSchulamtYear";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { getCurrentSchoolYear, getNextSchoolYear } from "@/lib/schoolYear";
import { RequestData } from "@/types/models";
import { DashboardHeader } from "./DashboardHeader";
import { KpiDetailDialog } from "./dialogs/KpiDetailDialog";

const NAV_ITEMS = [
  { href: "/schulamt", label: "Bedarfsübersicht", icon: ClipboardList },
  { href: "/schulamt/idealbesetzung", label: "Idealbesetzung", icon: Wand2 },
  { href: "/schulamt/reserven", label: "Mobile Reserven", icon: Users },
  { href: "/schulamt/schulen", label: "Schulen", icon: School },
  { href: "/schulamt/statistiken", label: "Statistiken", icon: BarChart3 },
  { href: "/schulamt/dokumentation", label: "Dokumentation", icon: FolderArchive },
  { href: "/schulamt/einstellungen", label: "Einstellungen", icon: Settings },
] as const;

interface SchulamtLayoutClientProps {
  schulamtId: string;
  children: ReactNode;
}

/**
 * Rahmen für alle vier Schulamt-Seiten: Kopfzeile, KPI-Kacheln und Navigation liegen hier,
 * weil sie auf jeder Unterseite gleich aussehen. Next.js behält den State dieses Layouts
 * über die Navigation zwischen den Unterseiten hinweg bei (kein Remount), deshalb kann die
 * Schuljahr-Auswahl hier leben, ohne dass jede Seite sie erneut anfordern müsste.
 */
export function SchulamtLayoutClient({ schulamtId, children }: SchulamtLayoutClientProps) {
  return (
    <SchulamtYearProvider>
      <SchulamtLayoutInner schulamtId={schulamtId}>{children}</SchulamtLayoutInner>
    </SchulamtYearProvider>
  );
}

function SchulamtLayoutInner({ schulamtId, children }: SchulamtLayoutClientProps) {
  const { selectedYear, setSelectedYear, availableYears } = useSchulamtYear();
  // Bewusst nur die Endpunkte, die die Kopfzeile (KPI-Kacheln, Backup-Banner) selbst
  // braucht – die Schulliste holt sich jede Seite bei Bedarf über ihre eigene Hook-Instanz.
  const data = useSchulamtData({ endpoints: ["teachers", "requests", "profile"], year: selectedYear, setYear: setSelectedYear });
  const { toast } = useToast();
  const confirm = useConfirm();
  const pathname = usePathname();
  const router = useRouter();

  const [activeKpiDetail, setActiveKpiDetail] = useState<'reserven' | 'offene' | 'besetzte' | 'unavailable' | null>(null);
  const [isCopying, setIsCopying] = useState(false);
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);

  const pendingTeacherCount = data.teachers.filter(t => t.status === 'PENDING').length;

  const handleCopyTeachers = async () => {
    if (selectedYear !== getNextSchoolYear()) {
      toast({ variant: "error", title: "Sie können Lehrkräfte nur in das nächste Schuljahr kopieren. Bitte wählen Sie oben das nächste Schuljahr aus." });
      return;
    }
    const sourceYear = getCurrentSchoolYear();
    const confirmed = await confirm({
      title: "Lehrkräfte kopieren?",
      description: `Möchten Sie alle Lehrkräfte aus dem aktuellen Schuljahr (${sourceYear}) in das nächste Schuljahr (${selectedYear}) kopieren?`,
      confirmLabel: "Kopieren"
    });
    if (!confirmed) return;

    setIsCopying(true);
    try {
      const res = await fetch("/api/teachers/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceYear, targetYear: selectedYear })
      });
      const respData = await res.json();
      if (res.ok) {
        toast({ variant: "success", title: `${respData.copied} Lehrkräfte wurden erfolgreich kopiert!` });
        data.loadData(selectedYear);
      } else {
        toast({ variant: "error", title: respData.error || "Fehler beim Kopieren." });
      }
    } catch {
      toast({ variant: "error", title: "Ein Fehler ist aufgetreten." });
    } finally {
      setIsCopying(false);
    }
  };

  const handleDownloadBackup = async () => {
    setIsDownloadingBackup(true);
    try {
      const res = await fetch("/api/backup/export");
      if (!res.ok) throw new Error("Export fehlgeschlagen");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schulamt_backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();

      // Refresh profile data to hide banner
      data.loadData();
    } catch (e) {
      toast({ variant: "error", title: "Fehler beim Backup-Download." });
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  /**
   * Die Matching-Engine (aktive Anfrage, Kandidatenliste) lebt nur auf /schulamt. Von den
   * anderen drei Seiten aus – oder auch von /schulamt selbst – wird deshalb per
   * Query-Parameter dorthin verlinkt statt über geteilten State; die Seite selbst wählt
   * die Anfrage beim Erkennen des Parameters aus und scrollt zur Matching Engine.
   */
  const handleSelectRequestFromKpi = (request: RequestData) => {
    setActiveKpiDetail(null);
    router.push(`/schulamt?matchRequestId=${request.id}`);
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {data.profile && (!data.profile.lastBackupDate || new Date(data.profile.lastBackupDate).toDateString() !== new Date().toDateString()) && (
        <div className="bg-red-50 dark:bg-red-500/10 border-l-4 border-red-500 dark:border-red-500/60 p-4 rounded-r-md flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-sm">
          <div>
            <h3 className="text-red-800 dark:text-red-300 font-bold text-lg">⚠️ Tägliches Backup ausstehend!</h3>
            <p className="text-red-700 dark:text-red-300/90 text-sm mt-1">Aus DSGVO-Gründen und zur Datensicherheit muss täglich ein lokales Backup der Datenbank heruntergeladen werden. Bitte führen Sie das Backup jetzt aus.</p>
          </div>
          <button
            onClick={handleDownloadBackup}
            disabled={isDownloadingBackup}
            className="bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-500 text-white font-medium px-4 py-2 rounded-md transition-colors whitespace-nowrap disabled:opacity-50"
          >
            {isDownloadingBackup ? 'Herunterladen...' : 'Backup jetzt herunterladen'}
          </button>
        </div>
      )}

      <DashboardHeader
        selectedYear={selectedYear}
        setSelectedYear={setSelectedYear}
        availableYears={availableYears}
        teachers={data.teachers}
        requests={data.requests}
        schulamtId={schulamtId}
        // Der "Lehrkraft hinzufügen"-Dialog wird von der Reserven-Seite gerendert (lokaler
        // State dort) – von hier aus wird per Query-Parameter dorthin verlinkt.
        setIsAddTeacherOpen={(open) => { if (open) router.push("/schulamt/reserven?openAdd=1"); }}
        handleCopyTeachers={handleCopyTeachers}
        isCopying={isCopying}
        setActiveKpiDetail={setActiveKpiDetail}
        activeTeacherCount={data.activeTeacherCount}
        openRequestCount={data.openRequestCount}
        filledRequestCount={data.filledRequestCount}
        sickTeacherCount={data.sickTeacherCount}
      />

      <nav className="flex flex-wrap gap-2 bg-card/60 border border-border rounded-2xl p-2 backdrop-blur-xl shadow-sm">
        {NAV_ITEMS.map(item => {
          const isActive = item.href === "/schulamt" ? pathname === "/schulamt" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
                isActive ? "bg-primary text-primary-foreground shadow-md" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
              {item.href === "/schulamt/reserven" && pendingTeacherCount > 0 && (
                <span className="ml-0.5 bg-red-500 text-white text-[10px] rounded-full w-5 h-5 flex items-center justify-center animate-pulse">
                  {pendingTeacherCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {children}

      <KpiDetailDialog
        activeKpiDetail={activeKpiDetail}
        setActiveKpiDetail={setActiveKpiDetail}
        teachers={data.teachers}
        openRequests={data.openRequests}
        filledRequests={data.filledRequests}
        sickTeachers={data.sickTeachers}
        openRequestCount={data.openRequestCount}
        filledRequestCount={data.filledRequestCount}
        sickTeacherCount={data.sickTeacherCount}
        handleSelectRequestFromKpi={handleSelectRequestFromKpi}
      />
    </div>
  );
}
