import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { SchoolYearArchiveButton } from "../../src/components/schulamt/SchoolYearArchiveButton";

function Preview() {
  const [dark, setDark] = useState(false);
  const selectedYear = "2025/2026";
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  return <div>
    <main className="min-h-screen space-y-6 bg-background p-4 text-foreground sm:p-8">
      <h1 className="text-2xl font-semibold">Schuljahresarchiv – lokale UI-Prüfung</h1>
      <p>Nur erfundene Beispieldaten. Test-Anmeldepasswort: UI-Testpasswort</p>
      <button type="button" onClick={() => setDark(value => !value)}>Hell/Dunkel wechseln</button>
      <section className="max-w-2xl rounded-xl border bg-card p-4">
        <SchoolYearArchiveButton selectedYear={selectedYear} />
      </section>
    </main>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
