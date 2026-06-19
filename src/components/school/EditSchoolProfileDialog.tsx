import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { MapPin, AlertTriangle } from "lucide-react";
import Image from "next/image";
import dynamic from "next/dynamic";

const LocationPickerMap = dynamic(() => import('@/components/LocationPickerMap'), {
  ssr: false,
  loading: () => <div className="h-[250px] w-full bg-slate-100 dark:bg-slate-800 animate-pulse rounded-md mt-2 flex items-center justify-center text-slate-500">Lade Karte...</div>
});

export function EditSchoolProfileDialog({
  isOpen,
  setIsOpen,
  profileData,
  setProfileData,
  fileToUpload,
  setFileToUpload,
  handleSaveProfile,
  isSavingProfile,
  setIsResetDataOpen
}: {
  isOpen: boolean;
  setIsOpen: (v: boolean) => void;
  profileData: { generalInfo: string; imageUrl: string; pinLat: number; pinLng: number; };
  setProfileData: (v: React.SetStateAction<{ generalInfo: string; imageUrl: string; pinLat: number; pinLng: number; }>) => void;
  fileToUpload: File | null;
  setFileToUpload: (v: File | null) => void;
  handleSaveProfile: (e: React.FormEvent) => void;
  isSavingProfile: boolean;
  setIsResetDataOpen: (v: boolean) => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schulprofil bearbeiten</DialogTitle>
          <DialogDescription>
            Hinterlegen Sie allgemeine Informationen, ein Foto und markieren Sie den Parkplatz/Eingang für die Mobilen Reserven.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSaveProfile} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="generalInfo">Allgemeine Informationen (z.B. Anmeldung im Sekretariat)</Label>
            <Textarea 
              id="generalInfo" 
              value={profileData.generalInfo} 
              onChange={e => setProfileData({...profileData, generalInfo: e.target.value})} 
              className="h-24"
            />
          </div>
          <div className="space-y-2">
            <Label>Schul-Foto / Parkplatz (Optional)</Label>
            <div className="flex items-center gap-4">
              <Input type="file" accept="image/*" onChange={e => {
                if (e.target.files && e.target.files.length > 0) {
                  setFileToUpload(e.target.files[0]);
                }
              }} />
              {profileData.imageUrl && !fileToUpload && (
                <Image src={profileData.imageUrl} alt="Schule" width={64} height={64} className="w-16 h-16 object-cover rounded-md" />
              )}
            </div>
          </div>
          <div className="space-y-2 pt-2 border-t">
            <Label className="flex items-center gap-2"><MapPin className="h-4 w-4 text-indigo-500" /> Karten-Pin (Eingang / Parkplatz)</Label>
            <p className="text-xs text-slate-500 mb-2">Klicken Sie auf die Karte, um den genauen Parkplatz oder Haupteingang für die Mobilen Reserven zu markieren.</p>
            <LocationPickerMap 
              lat={profileData.pinLat} 
              lng={profileData.pinLng} 
              onChange={(lat, lng) => setProfileData({...profileData, pinLat: lat, pinLng: lng})} 
            />
          </div>
          <DialogFooter className="pt-4">
            <Button type="submit" disabled={isSavingProfile} className="w-full">
              {isSavingProfile ? "Speichern..." : "Profil speichern"}
            </Button>
          </DialogFooter>
        </form>

        <div className="mt-8 border-t border-rose-200 dark:border-rose-900 pt-6">
          <h3 className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5" /> Gefahrenzone
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            Am Ende des Schuljahres können Sie hier alle Anfragen und Zuweisungen Ihrer Schule unwiderruflich löschen. Ihr Schulprofil bleibt erhalten.
          </p>
          <Button variant="destructive" className="w-full" onClick={() => { setIsOpen(false); setIsResetDataOpen(true); }}>
            Alle Daten (Anfragen) löschen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
