import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import ReactMarkdown from "react-markdown";

export function ImpressumDialog({
  isOpen,
  setIsOpen,
}: {
  isOpen: boolean;
  setIsOpen: (val: boolean) => void;
}) {
  const [impressum, setImpressum] = useState("");
  const [privacyPolicy, setPrivacyPolicy] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetch("/api/public/settings")
        .then((res) => res.json())
        .then((data) => {
          if (data.impressum) setImpressum(data.impressum);
          if (data.privacyPolicy) setPrivacyPolicy(data.privacyPolicy);
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  const defaultImpressum = "Kein Impressum hinterlegt.";
  const defaultPrivacyPolicy = "Keine Datenschutzerklärung hinterlegt.";

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-white/20 shadow-2xl overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-xl text-center text-primary">Rechtliche Hinweise</DialogTitle>
          <DialogDescription className="text-center">
            Informationen zum Betreiber und Datenschutz gemäß DSGVO.
          </DialogDescription>
        </DialogHeader>
        
        {loading ? (
          <div className="flex-1 flex items-center justify-center py-10">
            <span className="animate-pulse text-slate-400">Lade Inhalte...</span>
          </div>
        ) : (
          <Tabs defaultValue="impressum" className="flex-1 flex flex-col min-h-0">
            <TabsList className="grid w-full grid-cols-2 mb-4 shrink-0">
              <TabsTrigger value="impressum">Impressum</TabsTrigger>
              <TabsTrigger value="datenschutz">Datenschutz</TabsTrigger>
            </TabsList>
            
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <TabsContent value="impressum" className="m-0 focus-visible:outline-none">
                <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300">
                  <ReactMarkdown>{impressum || defaultImpressum}</ReactMarkdown>
                </div>
              </TabsContent>
              
              <TabsContent value="datenschutz" className="m-0 focus-visible:outline-none">
                <div className="prose prose-sm dark:prose-invert max-w-none text-slate-700 dark:text-slate-300">
                  <ReactMarkdown>{privacyPolicy || defaultPrivacyPolicy}</ReactMarkdown>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        )}
        
        <DialogFooter className="shrink-0 pt-4">
          <Button onClick={() => setIsOpen(false)} className="w-full sm:w-auto rounded-xl">
            Verstanden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
