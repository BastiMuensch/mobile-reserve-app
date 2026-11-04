import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AssignmentSettings } from '../../src/components/schulamt/settings/AssignmentSettings';
import { TeacherQualificationFields } from '../../src/components/teacher/TeacherQualificationFields';
import { SchoolRequestForm } from '../../src/components/school/SchoolRequestForm';
import { ToastProvider } from '../../src/components/ui/toast';
import { ConfirmProvider } from '../../src/components/ui/confirm-dialog';
import type { TeacherQualificationForm } from '../../src/lib/teacherQualifications';
import type { TemplateSettingsForm } from '../../src/types/models';

const initial: TemplateSettingsForm = {
  headerText: '', returnAddress: '', logoUrl: '', contactAddress: '', contactPerson: '', city: '',
  amtsleitungName: '', amtsleitungTitle: '', signatureUrl: '', documentSubject: '', documentIntro: '',
  documentLegalText: '', documentClosing: '', specialistRequestsEnabled: true,
  specialistFields: ['E/G', 'M/T', 'LANGEFACHRICHTUNG'.repeat(2)], schoolDistricts: ['BT', 'BTL', 'LANGERBEZIRK'.repeat(4)],
};
function Preview() {
  const [settings, setSettings] = useState(initial);
  const [details, setDetails] = useState<TeacherQualificationForm>({ qualificationType: 'SPECIALIST', canTeachSports: false });
  const [fields, setFields] = useState<string[]>([]);
  const options = settings.specialistRequestsEnabled ? settings.specialistFields : [];
  return <main className="min-h-screen bg-background p-4 text-foreground">
    <div className="mx-auto max-w-3xl space-y-6">
      <section aria-label="Einstellungen" className="rounded-xl border p-4">
        <AssignmentSettings settings={settings} savedSettings={initial} onChange={setSettings} disabled={false} />
      </section>
      <section aria-label="Reserveprofil" className="rounded-xl border p-4">
        <form><TeacherQualificationFields value={details} onChange={setDetails} specialistFieldOptions={options}
          specialistFields={fields} onSpecialistFieldsChange={setFields} requireSpecialistField />
          <button type="submit">Profil prüfen</button>
        </form>
      </section>
      <section aria-label="Bedarfsmeldung">
        <SchoolRequestForm user={{ id: 'school-user', role: 'SCHOOL', email: 'test@example.invalid', schoolId: 'school', teacherId: null,
          school: { id: 'school', name: 'Testschule', type: 'GRUNDSCHULE', latitude: 0, longitude: 0 } }}
          fetchRequests={() => {}} specialistFieldOptions={options} />
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<ToastProvider><ConfirmProvider><Preview /></ConfirmProvider></ToastProvider>);
