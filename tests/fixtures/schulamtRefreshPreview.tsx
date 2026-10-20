import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useCreateSchulamtData } from '../../src/hooks/useSchulamtData';

function Fixture() {
  const [year, setYear] = useState('2025/2026');
  const [finishMutation, setFinishMutation] = useState<(() => void) | null>(null);
  const data = useCreateSchulamtData({ endpoints: ['teachers'], year, setYear });
  return <main>
    <button onClick={() => setFinishMutation(() => () => void data.loadData())}>Änderung beginnen</button>
    <button onClick={() => finishMutation?.()}>Änderung abschließen</button>
    <button onClick={() => setYear('2026/2027')}>Nächstes Schuljahr</button>
    <button onClick={() => void data.loadData()}>Aktualisieren</button>
    <output data-testid="snapshot">{JSON.stringify({
      year,
      names: data.teachers.map(teacher => teacher.name),
      loading: data.isLoading,
      refreshing: data.isRefreshing,
      error: data.error,
      revision: data.revision,
    })}</output>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
