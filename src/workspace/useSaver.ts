import { useEffect, useMemo, useRef, useState } from 'react';
import { saveDocument, type DocSnapshot } from '../lib/api.ts';
import { Autosaver, type SaveState } from '../lib/autosave.ts';
import type { StudyDocument } from '../lib/types.ts';
import { useWorkspace } from './store.ts';

/** A device copy of a document's unsaved work, in case the tab closes before it's saved. */
interface Backup {
  version: number;
  at: number;
  snapshot: DocSnapshot;
}

const backupKey = (id: string) => `chip-study-doc-${id}`;

export function readBackup(doc: StudyDocument): DocSnapshot | null {
  try {
    const raw = localStorage.getItem(backupKey(doc.id));
    if (!raw) return null;
    const b = JSON.parse(raw) as Backup;
    // Only work made over the version the server still has, and after its last save.
    if (b.version !== doc.version || b.at <= Date.parse(doc.updated_at) + 1000) return null;
    return b.snapshot;
  } catch {
    return null;
  }
}

export function clearBackup(id: string) {
  try {
    localStorage.removeItem(backupKey(id));
  } catch {
    // Nothing kept.
  }
}

/** Saves [doc] as it changes (see Autosaver): change() with a function that gives the document
 * as it is now, read only when it's time to save. */
export function useSaver(doc: StudyDocument) {
  const [state, setState] = useState<SaveState>('saved');
  const backupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<(() => DocSnapshot) | null>(null);

  const saver = useMemo(() => {
    const keepBackup = (version: number) => {
      if (backupTimer.current) clearTimeout(backupTimer.current);
      backupTimer.current = setTimeout(() => {
        if (!latest.current) return;
        try {
          localStorage.setItem(backupKey(doc.id), JSON.stringify({ version, at: Date.now(), snapshot: latest.current() } satisfies Backup));
        } catch {
          // Storage full or private: the server copy will do.
        }
      }, 1500);
    };
    const s: Autosaver<() => DocSnapshot> = new Autosaver<() => DocSnapshot>(doc.version, {
      save: async (read, version) => {
        const snapshot = read();
        const answer = await saveDocument(doc.id, version, snapshot);
        if (answer.ok) {
          const { docs, assignment } = useWorkspace.getState();
          useWorkspace.setState({
            docs: docs.map((d) => (d.id === doc.id ? { ...d, version: answer.version, content: snapshot.content, text: snapshot.text, words: snapshot.words, chip_words: snapshot.chipWords } : d)),
            assignment: assignment && doc.kind === 'doc' && docs.find((d) => d.kind === 'doc')?.id === doc.id ? { ...assignment, words: snapshot.words } : assignment,
          });
          if (!s.unsaved) clearBackup(doc.id);
        }
        return answer;
      },
      onState: (st) => {
        setState(st);
        useWorkspace.setState({ saveState: st });
      },
      backup: (read) => {
        latest.current = read;
        keepBackup(s.version);
      },
    });
    return s;
  }, [doc.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const flush = () => void saver.flush();
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    // Leaving with unsaved work: the browser asks first.
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (saver.unsaved) {
        flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', beforeUnload);
      void saver.flush().finally(() => saver.dispose());
      if (backupTimer.current) clearTimeout(backupTimer.current);
    };
  }, [saver]);

  return { saver, state };
}
