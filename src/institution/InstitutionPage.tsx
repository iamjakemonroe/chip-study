import { ArrowLeft, Building2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ChipLoader } from '../components/ChipLoader.tsx';
import { Orb } from '../components/Orb.tsx';
import { TopBar } from '../components/TopBar.tsx';
import { ApiError, institutionOverview, listClasses, notAllowed } from '../lib/api.ts';
import { countryName, institutionStatus, KIND_LABEL, ROLE_LABEL, TONE_CLASS } from '../lib/institutions.ts';
import type { InstitutionOverview, StudyClass } from '../lib/types.ts';
import { ClassesTab } from './ClassesTab.tsx';
import { InviteTab } from './InviteTab.tsx';
import { OverviewTab } from './OverviewTab.tsx';
import { SettingsTab } from './SettingsTab.tsx';
import { StudentsTab } from './StudentsTab.tsx';

export type Tab = 'overview' | 'students' | 'classes' | 'invite' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'students', label: 'Students' },
  { id: 'classes', label: 'Classes' },
  { id: 'invite', label: 'Invite' },
  { id: 'settings', label: 'Settings' },
];

/** What the tabs share: the institution as last loaded, its classes, and ways to load them again
 * or move to another tab (with a class picked, for inviting into it). */
export interface InstitutionView {
  ov: InstitutionOverview;
  classes: StudyClass[] | null;
  reload: () => Promise<void>;
  reloadClasses: () => Promise<void>;
  go: (tab: Tab, classId?: string) => void;
}

/** An institution's dashboard, for its admins and teachers: how its students are getting on,
 * the students themselves, classes, inviting people, and its settings. Teachers see only their
 * own classes and students. */
export function InstitutionPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const [ov, setOv] = useState<InstitutionOverview | null>(null);
  const [failed, setFailed] = useState<'gone' | 'error' | null>(null);
  const [classes, setClasses] = useState<StudyClass[] | null>(null);

  const reload = useCallback(async () => {
    try {
      setOv(await institutionOverview(id));
      setFailed(null);
    } catch (e) {
      setFailed(notAllowed(e) || (e instanceof ApiError && /invalid input/.test(e.raw)) ? 'gone' : 'error');
    }
  }, [id]);

  const reloadClasses = useCallback(async () => {
    try {
      setClasses(await listClasses(id));
    } catch {
      setClasses((c) => c ?? []);
    }
  }, [id]);

  useEffect(() => {
    setOv(null);
    setClasses(null);
    void reload();
    void reloadClasses();
  }, [reload, reloadClasses]);

  useEffect(() => {
    if (ov) document.title = `${ov.institution.name} · Chip Study`;
  }, [ov]);

  const go = useCallback(
    (next: Tab, classId?: string) => {
      setParams(classId ? { tab: next, class: classId } : next === 'overview' ? {} : { tab: next }, { replace: false });
      window.scrollTo({ top: 0 });
    },
    [setParams],
  );

  if (failed === 'gone') {
    return (
      <div className="min-h-dvh">
        <TopBar />
        <main className="mx-auto flex max-w-md flex-col items-center px-6 pb-24 pt-20 text-center">
          <Orb size={56} />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">This isn’t yours to open</h1>
          <p className="mt-2 leading-relaxed text-ink-3">Only an institution’s admins and teachers can open its dashboard. If you should be one, ask an admin there for an invite.</p>
          <Link to="/app" className="btn btn-primary mt-6">
            Back to my desk
          </Link>
        </main>
      </div>
    );
  }

  if (!ov) {
    return (
      <div className="min-h-dvh">
        <TopBar />
        {failed ? (
          <main className="mx-auto max-w-md px-6 pt-20 text-center">
            <p className="text-ink-2">Couldn’t open this institution just now.</p>
            <button className="btn btn-primary mt-5" onClick={() => void reload()}>
              Try again
            </button>
          </main>
        ) : (
          <div className="h-[60vh]">
            <ChipLoader page={false} label="Opening your institution" />
          </div>
        )}
      </div>
    );
  }

  const i = ov.institution;
  const status = institutionStatus(i);
  const view: InstitutionView = { ov, classes, reload, reloadClasses, go };

  return (
    <div className="min-h-dvh">
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <Link to="/app" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-3 hover:text-ink">
          <ArrowLeft size={15} /> Your desk
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-3">
              <Building2 size={15} className="flex-none" /> {KIND_LABEL[i.kind]} · {countryName(i.country)}
            </p>
            <h1 className="mt-1 break-words text-[2rem] font-semibold leading-tight tracking-[-0.025em] sm:text-[2.25rem]">{i.name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`chip-tag ${TONE_CLASS[status.tone]}`}>{status.label}</span>
            <span className="chip-tag bg-iris-soft text-iris-2">You’re {ov.role === 'admin' ? 'an admin' : 'a teacher'}</span>
          </div>
        </div>

        <div className="no-scrollbar mt-7 flex max-w-full overflow-x-auto">
          <div className="flex w-full flex-none rounded-full border border-line bg-white/70 p-0.5 text-[0.8125rem] font-semibold sm:w-auto sm:text-sm" role="tablist" aria-label="Institution">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="inst-panel"
                onClick={() => go(t.id)}
                className={`flex-1 rounded-full px-2 py-1.5 transition-colors sm:flex-none sm:px-3.5 ${tab === t.id ? 'bg-ink text-white' : 'text-ink-3 hover:text-ink'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div id="inst-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mt-6">
          {tab === 'overview' && <OverviewTab view={view} />}
          {tab === 'students' && <StudentsTab view={view} />}
          {tab === 'classes' && <ClassesTab view={view} />}
          {tab === 'invite' && <InviteTab view={view} initialClass={params.get('class')} />}
          {tab === 'settings' && <SettingsTab view={view} />}
        </div>
        <p className="mt-10 text-center text-xs text-ink-4">{ROLE_LABEL[ov.role]}s see activity and AI-use records, never students’ chats, notes or documents.</p>
      </main>
    </div>
  );
}
