import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import React from "react";

export function ImpressumDialog({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[500px] rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-white/20 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl text-center text-primary">Impressum & Datenschutzerklärung</DialogTitle>
          <DialogDescription className="text-center">
            Informationen zum Betreiber und Datenschutz gemäß DSGVO.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4 text-sm text-slate-700 dark:text-slate-300">
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">Anbieterkennzeichnung (gem. § 5 TMG)</h3>
            <p className="mt-1">
              MobileReserve.digital<br/>
              Max-Mustermann-Straße 1<br/>
              12345 Musterstadt<br/>
              Vertreten durch: Max Mustermann<br/>
              E-Mail: info@mobilereserve.digital
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 dark:text-white">Datenschutz</h3>
            <p className="mt-1">
              Wir nehmen den Schutz Ihrer persönlichen Daten sehr ernst. Wir behandeln Ihre personenbezogenen Daten vertraulich und entsprechend der gesetzlichen Datenschutzvorschriften sowie dieser Datenschutzerklärung. Die Nutzung unserer Webseite ist in der Regel ohne Angabe personenbezogener Daten möglich. Soweit auf unseren Seiten personenbezogene Daten (beispielsweise Name, Anschrift oder E-Mail-Adressen) erhoben werden, erfolgt dies, soweit möglich, stets auf freiwilliger Basis.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => setIsOpen(false)} className="w-full sm:w-auto rounded-xl">
            Verstanden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
