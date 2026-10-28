import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Orb } from '../components/Orb.tsx';

const MODES: { name: string; title: string; body: string; demo: ReactNode }[] = [
  {
    name: 'Guide me',
    title: 'A tutor that asks before it tells',
    body: 'Chip finds out what you think, gives you a hint and the next small step, and lets you get there yourself. That’s why it sticks. Want it straight? “Just explain it” is one tap away.',
    demo: <GuideDemo />,
  },
  {
    name: 'Explain',
    title: 'Step by step, until it clicks',
    body: 'A clear explanation with a worked example, at your level, then one quick question to check you’ve really got it.',
    demo: <ExplainDemo />,
  },
  {
    name: 'Check my work',
    title: 'Tells you what’s wrong, and why',
    body: 'Show Chip an answer, a solution, code or a draft. It says what’s right, finds each mistake, explains why, and gives you a hint to fix it yourself.',
    demo: <CheckDemo />,
  },
  {
    name: 'Practice',
    title: 'Quizzes and flashcards from your notes',
    body: 'Chip turns your notes and readings into questions at your level. Save the cards to your review deck, and they come back just before you’d forget.',
    demo: <QuizDemo />,
  },
  {
    name: 'Plan',
    title: 'A plan to your exam or deadline',
    body: 'What to learn in what order, with practice and review along the way, or an assignment outline with steps that land in your checklist.',
    demo: <PlanDemo />,
  },
  {
    name: 'Write in my words',
    title: 'Your writing, with a coach beside you',
    body: 'Feedback, questions and outlines while you write. Ask for a draft and Chip writes in your voice, marked as Chip’s until you make it yours.',
    demo: <WriteDemo />,
  },
];

/** Chip's modes, one at a time, moving on by themselves (gently) until you pick one. */
export function ModesTour() {
  const [at, setAt] = useState(0);
  const [held, setHeld] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (held || !seen || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = setTimeout(() => setAt((a) => (a + 1) % MODES.length), 7000);
    return () => clearTimeout(id);
  }, [at, held, seen]);

  const m = MODES[at];
  return (
    <section id="chip" className="l-section" aria-labelledby="chip-title">
      <div className="l-wrap">
        <div className="mx-auto max-w-2xl text-center">
          <p className="l-kicker r-up">Meet Chip</p>
          <h2 id="chip-title" className="l-h2 r-up" style={{ ['--d' as string]: '0.06s' }}>
            A tutor that helps you think.
          </h2>
          <p className="l-sublead r-up" style={{ ['--d' as string]: '0.12s' }}>
            Chip knows your notes, your readings and your course, so its help is about what you’re learning, not learning in general.
          </p>
        </div>
        <div ref={box} className="l-tour r-up" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)} onFocus={() => setHeld(true)}>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Chip’s modes">
            {MODES.map((x, i) => (
              <button key={x.name} role="tab" id={`tour-tab-${i}`} aria-controls="tour-panel" aria-selected={i === at} className={`l-tour-tab ${i === at ? 'is-on' : ''}`} onClick={() => (setAt(i), setHeld(true))}>
                {x.name}
                {i === at && !held && <span className="l-tour-timer" key={at} />}
              </button>
            ))}
          </div>
          <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${at}`} className="mt-6 grid grid-cols-1 items-center gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div key={`t-${at}`} className="l-fade">
              <h3 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.025em]">{m.title}</h3>
              <p className="mt-3 text-lg leading-relaxed text-ink-2">{m.body}</p>
            </div>
            <div key={`d-${at}`} className="l-demo l-fade">
              <div className="flex items-center gap-2 border-b border-line px-4 py-3">
                <Orb size={22} />
                <span className="text-sm font-semibold">Chip</span>
                <span className="ml-auto rounded-full bg-ink px-2.5 py-1 text-[0.68rem] font-semibold text-white">{m.name}</span>
              </div>
              <div className="p-4 sm:p-5">{m.demo}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Ask({ children }: { children: ReactNode }) {
  return <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-iris-soft px-3.5 py-2 text-sm">{children}</p>;
}

function GuideDemo() {
  return (
    <div className="space-y-3">
      <Ask>How do I find the derivative of x²·sin x?</Ask>
      <p className="text-sm leading-relaxed text-ink-2">Good one. It’s two functions multiplied together. Which rule do you think we need for that?</p>
      <Ask>The product rule?</Ask>
      <p className="text-sm leading-relaxed text-ink-2">
        Exactly. So with <em>u</em> = x² and <em>v</em> = sin x, what’s <em>u′</em>? Try it, then we’ll put the pieces together.
      </p>
      <div className="flex gap-2">
        <span className="rounded-full px-2.5 py-1 text-xs font-semibold text-iris ring-1 ring-iris/20">Check my understanding</span>
        <span className="rounded-full px-2.5 py-1 text-xs font-semibold text-ink-3 ring-1 ring-line">Just explain it</span>
      </div>
    </div>
  );
}
function ExplainDemo() {
  return (
    <div className="space-y-3">
      <Ask>Just explain the product rule</Ask>
      <p className="text-sm leading-relaxed text-ink-2">When two functions are multiplied, the derivative is the first times the derivative of the second, plus the second times the derivative of the first:</p>
      <p className="rounded-xl bg-paper py-2 text-center font-serif italic text-ink">(uv)′ = u·v′ + v·u′</p>
      <p className="text-sm leading-relaxed text-ink-2">
        So for x²·sin x: x²·cos x + 2x·sin x. <b className="text-iris-2">Quick check:</b> what’s the derivative of x·eˣ?
      </p>
    </div>
  );
}
function CheckDemo() {
  return (
    <div className="space-y-3">
      <Ask>Check my answer: d/dx (x²·sin x) = 2x·cos x</Ask>
      <div className="rounded-2xl border border-line p-3 text-sm leading-relaxed">
        <p className="text-ink-2">
          <b className="text-mint">Right:</b> you differentiated both parts correctly (2x and cos x).
        </p>
        <p className="mt-1.5 text-ink-2">
          <b className="text-rose">Not quite:</b> you multiplied the two derivatives. With a product, each term keeps one function as it is.
        </p>
        <p className="mt-1.5 text-ink-2">
          <b className="text-iris-2">Hint:</b> write it as u·v′ + v·u′. What do you get now?
        </p>
      </div>
    </div>
  );
}
function PlanDemo() {
  const steps = [
    ['Limits and continuity: refresh', 'Today'],
    ['Product and chain rules, with practice', 'Tomorrow'],
    ['Review your flashcards', 'Thu'],
    ['A mock exam paper, checked by Chip', 'Mon'],
  ];
  return (
    <div className="space-y-3">
      <Ask>Make me a study plan to my exam</Ask>
      <ol className="space-y-2">
        {steps.map(([t, d], i) => (
          <li key={t} className="flex items-center gap-3 text-sm">
            <span className="grid h-6 w-6 flex-none place-items-center rounded-full bg-mint-soft text-xs font-bold text-mint">{i + 1}</span>
            <span className="flex-1">{t}</span>
            <span className="rounded-full bg-paper-2 px-2 py-0.5 text-xs font-semibold text-ink-3">{d}</span>
          </li>
        ))}
      </ol>
      <span className="btn btn-primary btn-sm pointer-events-none">Add 4 tasks to my plan</span>
    </div>
  );
}
function WriteDemo() {
  return (
    <div className="space-y-3">
      <Ask>Give me feedback on the paragraph I selected</Ask>
      <div className="rounded-2xl border border-line p-3 text-sm leading-relaxed text-ink-2">
        <p>
          Your point is strong, but it arrives at the end. <b className="text-ink">Lead with it</b>, then give the evidence. And “a lot of erosion” could be a number from your reading.
        </p>
        <p className="mt-2 text-xs text-ink-3">Want me to show you one way to reorder it?</p>
      </div>
      <p className="text-xs text-ink-3">Anything you take from Chip goes in <span className="chip-words">marked as Chip’s</span>, and into your AI-use record.</p>
    </div>
  );
}
function QuizDemo() {
  return (
    <div className="space-y-3">
      <Ask>Make flashcards of the key rules</Ask>
      <div className="l-flash">
        <div className="l-flash-card">
          <span className="text-lg font-semibold">The chain rule</span>
          <span className="mt-1 text-xs text-ink-4">Tap to turn over</span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-ink-3">1 / 12</p>
        <span className="btn btn-primary btn-sm pointer-events-none">Save to review</span>
      </div>
    </div>
  );
}
