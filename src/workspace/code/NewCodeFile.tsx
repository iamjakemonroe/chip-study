import { Check, Code2, Database, FileCode2, FileText, Globe } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Modal } from '../../components/ui.tsx';
import { freeName, langFromName } from './langs.ts';

/** Adding a code file: pick what it is (a web page comes as three linked files) and its name. */

export interface NewFile {
  name: string;
  lang: string;
  code: string;
}

const page = (style: string, script: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My page</title>
    <link rel="stylesheet" href="${style}" />
  </head>
  <body>
    <h1>Hello!</h1>
    <p>Change this page, ${style} and ${script}: the preview follows as you type.</p>
    <script src="${script}"></script>
  </body>
</html>
`;
const STYLE = `body {
  font-family: system-ui, sans-serif;
  margin: 2rem;
  line-height: 1.6;
}

h1 {
  color: #6457f0;
}
`;
const SCRIPT = `console.log("The page is running");
`;

const KINDS: { id: string; label: string; hint: string; icon: ReactNode; name: string }[] = [
  { id: 'python', label: 'Python', hint: 'Runs here, with numpy, pandas and plots', icon: <FileCode2 size={18} />, name: 'main.py' },
  { id: 'web', label: 'Web page', hint: 'HTML, CSS and JavaScript, with a live preview', icon: <Globe size={18} />, name: 'index.html' },
  { id: 'javascript', label: 'JavaScript', hint: 'Runs here, console and all', icon: <FileCode2 size={18} />, name: 'main.js' },
  { id: 'typescript', label: 'TypeScript', hint: 'Runs here too', icon: <FileCode2 size={18} />, name: 'main.ts' },
  { id: 'sql', label: 'SQL', hint: 'Queries on SQLite, results as tables', icon: <Database size={18} />, name: 'queries.sql' },
  { id: 'java', label: 'Java', hint: 'Write it here, Chip helps (runs on your computer)', icon: <Code2 size={18} />, name: 'Main.java' },
  { id: 'cpp', label: 'C / C++', hint: 'Write it here, Chip helps (runs on your computer)', icon: <Code2 size={18} />, name: 'main.cpp' },
  { id: 'markdown', label: 'Markdown', hint: 'Notes and READMEs, with a preview', icon: <FileText size={18} />, name: 'notes.md' },
];

export default function NewCodeFile({ open, onClose, taken, onCreate }: { open: boolean; onClose: () => void; taken: string[]; onCreate: (files: NewFile[]) => Promise<void> }) {
  const [kind, setKind] = useState('python');
  const [name, setName] = useState('main.py');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setKind('python');
      setName(freeName('main.py', taken));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id: string) => {
    setKind(id);
    setName(freeName(KINDS.find((k) => k.id === id)!.name, taken));
  };

  const files = (): NewFile[] => {
    if (kind === 'web') {
      const used = [...taken];
      const add = (n: string) => (used.push(freeName(n, used)), used[used.length - 1]);
      const html = add('index.html');
      const style = add('style.css');
      const script = add('script.js');
      return [
        { name: html, lang: 'html', code: page(style, script) },
        { name: style, lang: 'css', code: STYLE },
        { name: script, lang: 'javascript', code: SCRIPT },
      ];
    }
    const n = name.trim().slice(0, 200) || KINDS.find((k) => k.id === kind)!.name;
    return [{ name: freeName(n, taken), lang: langFromName(n)?.id ?? kind, code: '' }];
  };

  return (
    <Modal open={open} onClose={onClose} title="New code file" width={560}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          try {
            await onCreate(files());
            onClose();
          } finally {
            setBusy(false);
          }
        }}
      >
        <div role="radiogroup" aria-label="What kind of file" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="radio"
              aria-checked={kind === k.id}
              onClick={() => pick(k.id)}
              className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition-colors ${kind === k.id ? 'border-iris bg-iris-soft' : 'border-line hover:border-line-2 hover:bg-paper'}`}
            >
              <span className={`mt-0.5 ${kind === k.id ? 'text-iris' : 'text-ink-3'}`}>{k.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-ink">{k.label}</span>
                <span className="block text-xs text-ink-3">{k.hint}</span>
              </span>
            </button>
          ))}
        </div>
        {kind === 'web' ? (
          <p className="mt-4 text-sm text-ink-2">Adds index.html, style.css and script.js, already linked together.</p>
        ) : (
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-medium text-ink-2">File name</span>
            <input className="field font-mono" value={name} onChange={(e) => setName(e.target.value)} aria-label="File name" spellCheck={false} />
          </label>
        )}
        <div className="mt-5 flex justify-end">
          <button className="btn btn-primary btn-sm" disabled={busy}>
            <Check size={15} /> Add
          </button>
        </div>
      </form>
    </Modal>
  );
}
