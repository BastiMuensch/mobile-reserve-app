import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import RegisterTeacherPage from '../../src/app/register/teacher/page';
import { EditTeacherDialog } from '../../src/components/schulamt/dialogs/EditTeacherDialog';
import { AddTeacherDialog } from '../../src/components/schulamt/dialogs/AddTeacherDialog';
import { SchoolDistrictFilter } from '../../src/components/schulamt/SchoolDistrictField';
import { matchesSchoolDistrict } from '../../src/lib/schoolDistrict';
import type { EditTeacherForm, NewTeacherForm, SchoolData } from '../../src/types/models';
import { Button } from '../../src/components/ui/button';

const names = ['Albert-Schweitzer-Mittelschule', 'Alexander-von-Humboldt Grundschule Goldkronach', 'Christian-Sammet-Mittelschule Pegnitz', 'Graf-Botho-Grund- und Mittelschule Pottenstein', 'Grundschule Bayreuth-Herzoghöhe', 'Grundschule Hollfeld-Wonsees-Plankenfels'];
const schools: SchoolData[] = Array.from({ length: 30 }, (_, i) => ({
  id: `7693d52e-6a2a-4b25-927f-${String(i).padStart(12, '0')}`, name: `${names[i % names.length]}${i < names.length ? '' : ` ${i}`}`,
  address: 'Beispielstraße 1', latitude: null, longitude: null, type: 'GRUNDSCHULE', schoolDistrict: i % 3 === 0 ? null : i % 2 ? 'BT' : 'BTL',
}));
const form: NewTeacherForm = { name: 'Beispielreserve', stammschuleId: schools[4].id, onlyStammschule: false, schoolDistrict: 'BT', maxWeeklyHours: '28', qualifications: 'Deutsch', qualificationType: 'TEACHER_GS', canTeachSports: false, preferredType: 'BOTH', address: '', postalCode: '', homeLat: null, homeLng: null, isPartTime: false, email: 'reserve@example.invalid', password: '', phone: '0123456789', gender: 'FEMALE', schoolYear: '2026/2027' };
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {}, bfcacheId: 'fixture' };
function Preview() {
  const [view, setView] = useState('edit');
  const [open, setOpen] = useState(true);
  const [edit, setEdit] = useState<EditTeacherForm | null>({ ...form, id: 'fixture' });
  const [added, setAdded] = useState(form);
  const [district, setDistrict] = useState('ALL');
  const [schedule, setSchedule] = useState<Record<string, number[]>>({});
  return <AppRouterContext.Provider value={router}><SearchParamsContext.Provider value={new URLSearchParams('token=fixture-token')}>
    <main className="min-h-screen bg-background p-4 text-foreground">
      <div className="flex flex-wrap gap-3 mb-6">{['edit', 'add', 'registration'].map(value => <Button key={value} onClick={() => { setView(value); setOpen(true); }}>{value}</Button>)}</div>
      {view === 'registration' ? <RegisterTeacherPage /> : <>
        <SchoolDistrictFilter id="fixture-filter" value={district} onChange={setDistrict} districts={schools.map(school => school.schoolDistrict)} />
        <p data-testid="filtered-count">{schools.filter(school => matchesSchoolDistrict(school.schoolDistrict, district)).length}</p>
        <EditTeacherDialog isEditTeacherOpen={view === 'edit' && open} setIsEditTeacherOpen={setOpen} editTeacherData={edit} setEditTeacherData={setEdit} handleEditTeacher={event => event.preventDefault()} isEditingTeacher={false} sortedSchools={schools} editSchedule={schedule} setEditSchedule={setSchedule} />
        <AddTeacherDialog isAddTeacherOpen={view === 'add' && open} setIsAddTeacherOpen={setOpen} newTeacher={added} setNewTeacher={setAdded} handleAddTeacher={event => event.preventDefault()} isAdding={false} sortedSchools={schools} schedule={schedule} toggleDay={() => {}} toggleHour={() => {}} />
      </>}
    </main>
  </SearchParamsContext.Provider></AppRouterContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
