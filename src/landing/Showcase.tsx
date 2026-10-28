import { Orb } from '../components/Orb.tsx';

/** Chip Study in miniature, in HTML (so it's crisp at any size): the student's notes on the left,
 * Chip guiding them through a problem on the right. On phones it's just Chip. */
export function Showcase() {
  return (
    <div className="l-show" aria-label="Chip Study: a student’s notes on derivatives, with Chip guiding them through a problem" role="img">
      <div className="l-show-float l-show-float-a">
        <span className="grid h-5 w-5 place-items-center rounded-md bg-lilac-soft text-[0.6rem] font-bold text-lilac">14</span>
        cards to review today
      </div>
      <div className="l-show-float l-show-float-b">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-iris-soft text-[0.6rem] text-iris-2">▶</span>
        Focus <b className="tabular-nums">24:12</b>
      </div>
      <div className="l-window">
        <div className="l-window-bar">
          <span className="l-dots">
            <i />
            <i />
            <i />
          </span>
          <span className="truncate text-xs font-semibold text-ink-3">Calculus: derivatives</span>
          <span className="chip-tag ml-auto bg-iris-soft text-iris-2">Exam in 9 days</span>
        </div>
        <div className="l-window-body">
          <div className="l-show-doc">
            <p className="text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-ink-4">MATH 120 · My notes</p>
            <p className="mt-2 font-serif text-[1.35rem] font-semibold leading-tight tracking-[-0.01em] text-ink">The product rule</p>
            <p className="mt-3 font-serif text-[0.86rem] leading-[1.75] text-ink-2">
              When two functions are multiplied, each one takes a turn being differentiated while the other stays the same.{' '}
              <span className="chip-words">It’s like sharing the work: one changes, the other waits.</span>
            </p>
            <p className="my-3 rounded-xl bg-paper py-2.5 text-center font-serif text-[1.05rem] italic text-ink">(uv)′ = u·v′ + v·u′</p>
            <p className="font-serif text-[0.86rem] leading-[1.75] text-ink-2">
              Example: for x²·sin x, u = x² and v = sin x, so the derivative is x²·cos x + 2x·sin x<span className="l-caret" />
            </p>
            <div className="mt-4 space-y-2" aria-hidden="true">
              <span className="l-line w-full" />
              <span className="l-line w-4/5" />
            </div>
            <div className="mt-auto flex items-center gap-3 border-t border-line pt-3 text-[0.68rem] text-ink-3">
              <span>
                <b className="text-ink-2">642</b> words of notes
              </span>
              <span className="ml-auto flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-mint" /> Saved
              </span>
            </div>
          </div>
          <div className="l-show-chip">
            <div className="flex items-center gap-2">
              <Orb size={22} state="thinking" />
              <span className="text-sm font-semibold">Chip</span>
              <span className="ml-auto rounded-full bg-iris-soft px-2 py-0.5 text-[0.62rem] font-semibold text-iris-2">✦ Best</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {['Guide me', 'Explain', 'Check', 'Practice', 'Plan', 'Write'].map((m) => (
                <span key={m} className={`flex-none rounded-full px-2 py-1 text-[0.6rem] font-semibold ${m === 'Guide me' ? 'bg-ink text-white' : 'bg-white text-ink-3 ring-1 ring-line'}`}>
                  {m}
                </span>
              ))}
            </div>
            <p className="ml-auto mt-3 w-fit max-w-[85%] rounded-xl rounded-br-sm bg-iris-soft px-2.5 py-1.5 text-[0.72rem] text-ink">How do I differentiate x·eˣ?</p>
            <p className="mt-2.5 text-[0.72rem] leading-relaxed text-ink-2">It’s a product again. You’ve got this: what are u and v here, and what’s each one’s derivative?</p>
            <p className="ml-auto mt-2.5 w-fit max-w-[85%] rounded-xl rounded-br-sm bg-iris-soft px-2.5 py-1.5 text-[0.72rem] text-ink">u = x, v = eˣ… so x·eˣ + eˣ?</p>
            <div className="l-show-card mt-2.5">
              <p className="text-[0.72rem] leading-relaxed text-ink-2">
                <b className="text-mint">Exactly right.</b> You can even factor it: eˣ(x + 1).
              </p>
              <p className="mt-2 text-[0.58rem] font-bold uppercase tracking-[0.12em] text-lilac">Check your understanding · 1/3</p>
              <p className="mt-1 text-[0.7rem] font-semibold text-ink">What’s the derivative of x³·cos x?</p>
              <div className="mt-1.5 space-y-1">
                {['3x²·cos x − x³·sin x', '−3x²·sin x'].map((o, i) => (
                  <p key={o} className={`rounded-lg border px-2 py-1 text-[0.66rem] ${i === 0 ? 'border-mint bg-mint-soft' : 'border-line'}`}>
                    {String.fromCharCode(65 + i)} · {o}
                  </p>
                ))}
              </div>
            </div>
            <div className="mt-auto rounded-xl border border-line bg-white px-2.5 py-2 text-[0.66rem] text-ink-4">What are you working on?</div>
          </div>
        </div>
      </div>
    </div>
  );
}
