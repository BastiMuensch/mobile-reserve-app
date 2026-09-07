"use client";

import { ReactNode, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardList, Users, BarChart3, Settings, Wand2, School, FolderArchive, Menu, LogOut, Moon, RefreshCw, UserPlus, Copy, Download, ArrowRight } from "lucide-react";
import Image from "next/image";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/button";
import { SchulamtTasks } from "./SchulamtTasks";
import { useSchulamtData, useCreateSchulamtData, SchulamtDataProvider } from "@/hooks/useSchulamtData";
import { SchulamtYearProvider, useSchulamtYear } from "@/hooks/useSchulamtYear";
import { useToast } from "@/components/ui/toast";
import { RequestData } from "@/types/models";
import { DashboardHeader } from "./DashboardHeader";
import { KpiDetailDialog } from "./dialogs/KpiDetailDialog";
import { TeacherCopyDialog } from "./dialogs/TeacherCopyDialog";
import { UpdateAvailableBanner } from "@/components/updates/UpdateStatus";
import { confirmUnsavedNavigation } from "@/hooks/useUnsavedChanges";

const NAV_ITEMS = [
  { href: "/schulamt", label: "Übersicht", icon: ClipboardList },
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
 * Rahmen für alle Schulamt-Seiten: Kopfzeile, KPI-Kacheln und Navigation liegen hier,
 * weil sie auf jeder Unterseite gleich aussehen. Die Schuljahr-Auswahl und der zentrale
 * Datenkontext (SchulamtDataProvider) leben hier, sodass alle Unterseiten genau eine
 * gemeinsame Datenquelle und einen gemeinsamen Abruf nutzen.
 */
export function SchulamtLayoutClient({ schulamtId, children }: SchulamtLayoutClientProps) {
  return (
    <SchulamtYearProvider>
      <SchulamtLayoutContextWrapper schulamtId={schulamtId}>
        {children}
      </SchulamtLayoutContextWrapper>
    </SchulamtYearProvider>
  );
}

function SchulamtLayoutContextWrapper({ schulamtId, children }: SchulamtLayoutClientProps) {
  const { selectedYear, setSelectedYear } = useSchulamtYear();
  const sharedData = useCreateSchulamtData({
    endpoints: ["teachers", "requests", "schools", "profile"],
    year: selectedYear,
    setYear: setSelectedYear,
  });

  return (
    <SchulamtDataProvider value={sharedData}>
      <SchulamtLayoutInner schulamtId={schulamtId}>{children}</SchulamtLayoutInner>
    </SchulamtDataProvider>
  );
}

function SchulamtLayoutInner({ children }: SchulamtLayoutClientProps) {
  const { selectedYear, setSelectedYear, availableYears } = useSchulamtYear();
  const data = useSchulamtData();
  const { toast } = useToast();
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const isOverview = pathname === '/schulamt';
  const currentPage = NAV_ITEMS.find(item => item.href === pathname)?.label ?? 'Schulamt';

  const [activeKpiDetail, setActiveKpiDetail] = useState<'reserven' | 'offene' | 'besetzte' | 'unavailable' | null>(null);
  const [isTeacherCopyOpen, setIsTeacherCopyOpen] = useState(false);
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);

  const pendingTeacherCount = data.teachers.filter(t => t.status === 'PENDING').length;

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
    } catch {
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
    if (!confirmUnsavedNavigation()) return;
    setActiveKpiDetail(null);
    router.push(`/schulamt?matchRequestId=${request.id}`);
  };

  const navigation = (
    <nav aria-label="Schulamt-Navigation" className="space-y-1">
      {NAV_ITEMS.map(item => {
        const active = item.href === '/schulamt' ? isOverview : pathname.startsWith(item.href);
        return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
          onClick={() => setMobileNavOpen(false)}
          className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
          <item.icon className="size-5 shrink-0" aria-hidden="true" />{item.label}
          {item.href === '/schulamt/reserven' && pendingTeacherCount > 0 &&
            <span className="ml-auto rounded-md bg-amber-100 text-amber-900 px-2 py-0.5 text-xs">{pendingTeacherCount}<span className="sr-only"> Freigaben ausstehend</span></span>}
        </Link>;
      })}
    </nav>
  );

  return (
    <div className="min-h-[calc(100dvh-4rem)] lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a href="#schulamt-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-card focus:p-3">Zum Inhalt springen</a>
      <aside className="hidden lg:flex sticky top-0 h-dvh flex-col border-r border-border bg-card p-4">
        <Link href="/schulamt" className="mb-8 flex flex-col items-center gap-1 py-3 text-center">
          <span className="grid size-32 place-content-center overflow-hidden"><Image src="/logo_transparent.png" alt="MobileReserve.digital Logo" width={256} height={256} priority className="size-64 max-w-none" /></span>
          <span className="text-xl font-semibold">Mobile Reserve</span>
          <span className="text-sm text-muted-foreground">Schulamt</span>
        </Link>
        {navigation}
        <div className="mt-auto border-t border-border pt-4 space-y-3">
          <p className="px-3 text-sm font-medium break-words">{user?.name || 'Schulamt'}</p>
          <Button variant="ghost" className="w-full justify-start" disabled={loggingOut}
            onClick={() => { if (!confirmUnsavedNavigation()) return; setLoggingOut(true); void logout(); }}><LogOut className="size-4" />{loggingOut ? 'Abmelden …' : 'Abmelden'}</Button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="border-b border-border bg-card px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Navigation öffnen" aria-expanded={mobileNavOpen}
              aria-controls="mobile-authority-nav" onClick={() => setMobileNavOpen(!mobileNavOpen)}><Menu className="size-5" /></Button>
            <span className="lg:hidden grid size-10 place-content-center overflow-hidden"><Image src="/logo_transparent.png" alt="Mobile Reserve" width={80} height={80} className="size-20 max-w-none" /></span>
            <p className="text-sm"><span className="hidden sm:inline text-muted-foreground">Schulamt / </span><span className="font-medium">{currentPage}</span></p>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="authority-year" className="text-sm text-muted-foreground hidden sm:block">Schuljahr</label>
            <select id="authority-year" aria-label="Schuljahr" value={selectedYear} onChange={e => setSelectedYear(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-primary">
              {availableYears.map(year => <option key={year} value={year}>{year}</option>)}
            </select>
            <Button variant="ghost" size="icon" aria-label="Hell-/Dunkelmodus umschalten" onClick={() => {
              const dark = document.documentElement.classList.toggle('dark');
              try { localStorage.theme = dark ? 'dark' : 'light'; } catch { /* Storage is optional. */ }
            }}><Moon className="size-4" /></Button>
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abmelden" disabled={loggingOut}
              onClick={() => { if (!confirmUnsavedNavigation()) return; setLoggingOut(true); void logout(); }}><LogOut className="size-4" /></Button>
          </div>
        </header>
        {mobileNavOpen && <div id="mobile-authority-nav" className="lg:hidden border-b border-border bg-card p-3">{navigation}</div>}
        <div id="schulamt-content" className="mx-auto max-w-[1680px] p-4 sm:p-6 lg:p-8 space-y-7">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">{isOverview ? 'Heute im Überblick' : currentPage}</h1>
              {isOverview && <p className="text-sm text-muted-foreground mt-2">Bedarfe besetzen und Einsätze im Blick behalten.</p>}
              <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <span className={`size-2 rounded-full ${data.error ? 'bg-amber-500' : data.lastUpdated ? 'bg-primary' : 'bg-muted-foreground'}`} />
                {data.isRefreshing ? 'Daten werden aktualisiert …' : data.error ? 'Aktualisierung fehlgeschlagen' : data.lastUpdated
                  ? `Aktualisiert um ${data.lastUpdated.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · automatisch` : 'Daten werden geladen …'}
                <button type="button" disabled={data.isRefreshing} onClick={() => void data.loadData()} aria-label="Daten aktualisieren" className="p-1 rounded hover:bg-muted disabled:opacity-50"><RefreshCw className="size-3.5" /></button>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/schulamt/reserven?openInvite=1" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-primary/40 px-3 text-sm font-medium text-primary hover:bg-primary/5"><UserPlus className="size-4" />Reserve einladen</Link>
              {pathname === '/schulamt/reserven' && <>
                <Button variant="outline" onClick={() => { if (confirmUnsavedNavigation()) router.push('/schulamt/reserven?openAdd=1'); }}>Lehrkraft hinzufügen</Button>
                <Button variant="outline" onClick={() => setIsTeacherCopyOpen(true)}><Copy className="size-4" />Aus Vorjahr übernehmen</Button>
              </>}
            </div>
          </div>
          {data.error && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-200">
            <p className="font-medium">{data.error}</p>
            {data.lastUpdated && <p className="mt-1">Angezeigt wird der zuletzt geladene Stand. Bitte vor Änderungen aktualisieren.</p>}
            <Button className="mt-3" variant="outline" disabled={data.isRefreshing} onClick={() => void data.loadData()}>Erneut laden</Button>
          </div>}
          {data.profileWarning && <p role="status" className="rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{data.profileWarning}</p>}
          {isOverview && <DashboardHeader
            teacherCount={data.teachers.length} loading={data.isLoading}
            setActiveKpiDetail={setActiveKpiDetail}
            activeTeacherCount={data.activeTeacherCount} openRequestCount={data.openRequestCount}
            filledRequestCount={data.filledRequestCount} sickTeacherCount={data.sickTeacherCount}
          />}
          <UpdateAvailableBanner detailsHref="/schulamt/einstellungen#updates" />
          {data.isLoading ? <div className="rounded-xl border border-border bg-card p-10 text-center text-muted-foreground" role="status">
            {data.error ? 'Für dieses Schuljahr sind noch keine verlässlichen Daten geladen.' : 'Daten für das ausgewählte Schuljahr werden geladen …'}
          </div> : children}
          {isOverview && !data.isLoading && <SchulamtTasks pendingTeacherCount={pendingTeacherCount} />}
          {data.profile && (!data.profile.lastBackupDate || new Date(data.profile.lastBackupDate).toDateString() !== new Date().toDateString()) &&
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-sm">
              <div><p className="font-medium flex items-center gap-2"><Download className="size-4 text-primary" />Datensicherung</p>
                <p className="mt-1 text-muted-foreground">Heute wurde noch kein Backup-Export angefordert. Bewahren Sie Ihre Sicherungen geschützt auf.</p></div>
              <Button variant="outline" onClick={handleDownloadBackup} disabled={isDownloadingBackup}>
                {isDownloadingBackup ? 'Export wird erstellt …' : 'Backup herunterladen'}<ArrowRight className="size-4" />
              </Button>
            </div>}
        </div>
      </div>

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

      <TeacherCopyDialog
        key={selectedYear}
        open={isTeacherCopyOpen}
        onOpenChange={setIsTeacherCopyOpen}
        targetYear={selectedYear}
        onSuccess={({ copied, skipped, leavesCopied }) => {
          data.loadData();
          toast({
            variant: copied > 0 ? "success" : "info",
            title: copied > 0
              ? `${copied} ${copied === 1 ? "Lehrkraft wurde" : "Lehrkräfte wurden"} übernommen.`
              : "Keine weitere Lehrkraft übernommen.",
            description: `${leavesCopied} Langzeitabwesenheit${leavesCopied === 1 ? "" : "en"} übernommen${skipped > 0 ? `, ${skipped} übersprungen` : ""}.`,
          });
        }}
      />
    </div>
  );
}
