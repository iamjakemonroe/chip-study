/** Study guides: public pages that answer what students search for, carefully. Research is cited
 * only where the finding is well established and the reference is exact; there are no made-up
 * numbers. A block is a paragraph, a list (an array), or a tip set apart. */

export type GuideBlock = string | string[] | { tip: string };

export interface Guide {
  slug: 'how-to-study-for-exams' | 'spaced-repetition' | 'active-recall' | 'using-ai-without-cheating';
  /** On the page. */
  title: string;
  /** In the browser tab and search results. */
  metaTitle: string;
  description: string;
  lead: string;
  minutes: number;
  sections: { heading: string; body: GuideBlock[] }[];
  /** How Chip Study does it, said once, at the end. */
  inChipStudy: string;
  sources: string[];
}

export const GUIDES_UPDATED = '7 November 2026';

export const GUIDES: Guide[] = [
  {
    slug: 'how-to-study-for-exams',
    title: 'How to study for exams',
    metaTitle: 'How to study for exams: a calm plan that works · Chip Study',
    description: 'A step-by-step way to prepare for exams: know what you’ll be asked, plan backwards from the date, test yourself instead of rereading, space your revision out and practise under exam conditions.',
    lead: 'A calm plan that works for most subjects: find out exactly what you’ll be asked, test yourself more than you reread, spread your revision out, and practise the way you’ll be examined.',
    minutes: 7,
    sections: [
      {
        heading: 'Start with what the exam asks',
        body: [
          'Before you open your notes, find out what you’re preparing for. The clearer the target, the less time you spend revising things that won’t come up.',
          [
            'Get the syllabus or the list of learning outcomes, and any past papers and mark schemes your course shares.',
            'Note the format: how long, how many questions, multiple choice or essays, which topics are compulsory.',
            'List every topic, then mark each one: I know it, it’s shaky, or it’s new to me.',
          ],
          'That list is your map. Shaky and new topics get most of your time; the ones you know get short, regular checks so they stay known.',
        ],
      },
      {
        heading: 'Plan backwards from the date',
        body: [
          'Count the days you have, then work back from the exam. A plan you can keep beats an ambitious one you abandon by Wednesday.',
          [
            'Leave the last few days for full past papers and light review, not new topics.',
            'Give each topic more than one slot, a few days apart, instead of one long block.',
            'Keep sessions short with real breaks: 25 to 50 minutes of focus, then a few minutes away from the screen.',
            'Leave a spare day or two. Something always takes longer than planned.',
          ],
        ],
      },
      {
        heading: 'Test yourself instead of rereading',
        body: [
          'Rereading and highlighting feel productive because the material looks familiar, but recognising something isn’t the same as being able to recall it in an exam. Pulling it out of your memory is what makes it stick, and it shows you what you don’t know yet.',
          'This is one of the best-supported findings in learning research. In a large review of ten common study techniques, Dunlosky and colleagues (2013) rated practice testing and spreading practice over time as the most useful, and rereading and highlighting as among the least.',
          [
            'Close your notes and write down everything you remember about a topic, then check what you missed.',
            'Turn headings into questions and answer them out loud.',
            'Use flashcards for definitions, formulas and key facts.',
            'Do past questions before you feel ready: that’s the point.',
          ],
          { tip: 'If a session felt easy, it probably wasn’t doing much. A little struggle to remember is a sign it’s working.' },
        ],
      },
      {
        heading: 'Space it out',
        body: [
          'Coming back to a topic after a gap, just as it’s starting to fade, helps you keep it far longer than going over it many times in one sitting. Plan to see each topic again a day later, a few days later, and a week or so after that.',
          'Spaced repetition does this for you with flashcards. Our guide to spaced repetition explains how.',
        ],
      },
      {
        heading: 'Mix up your practice',
        body: [
          'In subjects where you solve problems, practising one type at a time can hide a real exam skill: working out which method a question needs. Mixing different kinds of problems in one session (interleaving) makes you make that choice each time. In one well-known study, students who practised maths problems mixed together did better on a later test than students who practised them in blocks (Rohrer and Taylor, 2007).',
        ],
      },
      {
        heading: 'Practise under exam conditions',
        body: [
          'In the last stretch, do full past papers, timed, without notes. Then mark them honestly against the mark scheme.',
          [
            'Note where you lost marks: not knowing it, misreading the question, or running out of time. Each needs a different fix.',
            'Practise planning answers quickly for essay questions: a few lines of structure before you write.',
            'Get used to the clock. Know roughly how long each question should take.',
          ],
        ],
      },
      {
        heading: 'Look after the basics',
        body: [
          'Sleep plays a part in how memories are kept, and a tired brain recalls less, so an all-nighter usually costs more than it gains. Eat properly, move a little each day, and keep your phone out of reach while you work.',
          'If you feel overwhelmed, shrink the next step: one topic, one session, one past question. If worry is getting in the way, talk to someone at your school or university: they have helped many students before you.',
        ],
      },
      {
        heading: 'The last few days',
        body: [
          [
            'Review your shaky list, not everything.',
            'Do one more timed paper, then go easy.',
            'Make a single page of the formulas, dates or definitions you keep forgetting, and test yourself on it.',
            'Sort out the practical things: where and when the exam is, what to bring, how you’ll get there.',
          ],
        ],
      },
    ],
    inChipStudy: 'Add your exam and its date, and Chip makes a plan to it, quizzes you on what you’re learning, turns your notes into flashcards that come back just before you’d forget them, and keeps a focus timer by your side.',
    sources: [
      'Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving students’ learning with effective learning techniques: Promising directions from cognitive and educational psychology. Psychological Science in the Public Interest, 14(1), 4–58.',
      'Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. Psychological Science, 17(3), 249–255.',
      'Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. Psychological Bulletin, 132(3), 354–380.',
      'Rohrer, D., & Taylor, K. (2007). The shuffling of mathematics problems improves learning. Instructional Science, 35(6), 481–498.',
    ],
  },
  {
    slug: 'spaced-repetition',
    title: 'Spaced repetition: remember what you learn',
    metaTitle: 'Spaced repetition explained, and how to use it · Chip Study',
    description: 'What spaced repetition is, why reviewing at growing intervals helps you remember, and how to write flashcards and build a daily review habit that lasts.',
    lead: 'Spaced repetition means reviewing something again just as you’re about to forget it, at gaps that grow each time you remember. It’s a simple idea that turns short, regular reviews into knowledge you keep.',
    minutes: 6,
    sections: [
      {
        heading: 'Forgetting is normal',
        body: [
          'In the 1880s, Hermann Ebbinghaus tested his own memory of lists he had learned and found it faded fast at first, then more slowly. That shape, the forgetting curve, is the starting point: if you learn something once and never come back to it, most of it goes.',
          'The good news is that each time you successfully recall something, it fades more slowly afterwards. So the next review can come later, and the one after that later still.',
        ],
      },
      {
        heading: 'Why spacing works',
        body: [
          'Spreading your practice over time (the spacing effect) leads to better long-term memory than the same amount of practice crammed together. It’s one of the most reliable findings in memory research; Cepeda and colleagues (2006) reviewed hundreds of experiments on it.',
          'Cramming can get you through a test tomorrow. Spacing is how you still know it at the end of the course, and the year after.',
        ],
      },
      {
        heading: 'How spaced repetition works',
        body: [
          'You keep what you want to remember on cards: a question on the front, the answer on the back. Each day you review only the cards that are due. For each one, you try to recall the answer before you look, then say honestly how it went.',
          [
            'Forgot it: it comes back soon, today or tomorrow.',
            'Remembered with effort: it comes back in a few days.',
            'Remembered easily: it comes back after a longer gap.',
          ],
          'Each time you remember a card, its gap grows. Paper versions of this go back to the Leitner box system of the 1970s, where cards move along a row of boxes reviewed less and less often; apps use formulas such as the SM-2 algorithm, first used in the SuperMemo program in the late 1980s.',
        ],
      },
      {
        heading: 'Writing cards that work',
        body: [
          [
            'One idea per card. “Three causes of the First World War” is three cards, or one card you’ll keep getting half right.',
            'Ask a real question. “Mitochondria?” is vague; “What do mitochondria produce for the cell?” is clear.',
            'Use your own words, so you understand it rather than recognise a phrase.',
            'Add a little context: the course, the chapter, or an example.',
            'Make cards after you understand something, not instead of understanding it.',
          ],
          { tip: 'If a card keeps tripping you up, it’s usually too big or too vague. Split it or rewrite it.' },
        ],
      },
      {
        heading: 'Make it a habit',
        body: [
          'A few minutes every day beats an hour once a week. Do your due cards first, at the same time each day if you can, and add new cards gradually: a big batch today means a big pile of reviews in a few days.',
          'Missed some days? Don’t delete everything and start again. Do the overdue cards a little at a time until you’ve caught up.',
        ],
      },
      {
        heading: 'Common mistakes',
        body: [
          [
            'Flipping the card too soon. Recall first, then check: the effort is what helps.',
            'Being generous with yourself. If you only half remembered, say so.',
            'Saving it all for exam week. Spaced repetition needs time to space.',
            'Only learning facts. Add cards that ask why and how, not just what.',
          ],
        ],
      },
    ],
    inChipStudy: 'Your review deck spaces every card for you: say how each one went and it comes back at the right time. Chip makes cards from your own notes and readings in one tap, and your streak shows the habit growing.',
    sources: [
      'Ebbinghaus, H. (1885). Über das Gedächtnis: Untersuchungen zur experimentellen Psychologie. Leipzig: Duncker & Humblot. (In English: Memory: A Contribution to Experimental Psychology, 1913.)',
      'Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006). Distributed practice in verbal recall tasks: A review and quantitative synthesis. Psychological Bulletin, 132(3), 354–380.',
      'Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving students’ learning with effective learning techniques. Psychological Science in the Public Interest, 14(1), 4–58.',
    ],
  },
  {
    slug: 'active-recall',
    title: 'Active recall: the study habit that makes things stick',
    metaTitle: 'Active recall: what it is and how to use it · Chip Study',
    description: 'Active recall means pulling what you’ve learned out of your memory instead of rereading it. Here’s why it works, and simple ways to use it in any subject.',
    lead: 'Active recall means getting information out of your head, not putting it back in. Instead of rereading your notes, you close them and try to remember. It feels harder, and that’s why it works.',
    minutes: 6,
    sections: [
      {
        heading: 'Rereading feels good. Recall works better',
        body: [
          'When you reread, the page looks familiar, and familiar feels like learned. But in an exam there’s no page: you have to bring the answer up yourself. Practising exactly that is what active recall is.',
          'In a well-known experiment, Roediger and Karpicke (2006) had students either reread a passage or practise recalling it. On a test a few minutes later, rereading did slightly better. But after two days, and again after a week, the students who had practised recalling it remembered more, even though the rereaders expected to do better.',
          'Another study found that practising retrieval produced more learning than spending the same time making detailed concept maps (Karpicke and Blunt, 2011).',
        ],
      },
      {
        heading: 'Ways to practise recall',
        body: [
          [
            'The blank page: after a lesson or a reading, write down everything you can remember, then compare with your notes and fill the gaps in another colour.',
            'Questions from headings: turn each heading in your notes into a question, cover the notes, and answer.',
            'Flashcards: a question on one side, the answer on the other. Say the answer before you turn it over.',
            'Teach it: explain the topic out loud, as if to a friend who missed the class. Where you stumble is where to study.',
            'Past questions: the closest practice to the real thing.',
          ],
        ],
      },
      {
        heading: 'Make it effortful, then check',
        body: [
          'Recall should be a bit of a stretch. If you can answer instantly, space it out more or make the question harder. If you can’t get anywhere at all, go back and learn it first, then try again later.',
          'Always check your answers. Getting it wrong and seeing the right answer is part of learning; getting it wrong and never finding out isn’t.',
          { tip: 'Wrong answers aren’t a sign that recall isn’t working. They show you exactly what to study next.' },
        ],
      },
      {
        heading: 'Put it together with spacing',
        body: [
          'Active recall tells you how to study; spacing tells you when. Recall a topic today, again in a couple of days, and again next week. Each round takes less time, and it lasts longer. Our guide to spaced repetition shows how to make that a habit.',
        ],
      },
      {
        heading: 'It works in every subject',
        body: [
          [
            'Sciences: recall the steps of a process, then draw it from memory.',
            'Maths: do problems without looking at worked examples first.',
            'Languages: produce the word or phrase, don’t just recognise it.',
            'Essay subjects: recall the main arguments, evidence and authors for a topic, then plan an answer from memory.',
          ],
        ],
      },
    ],
    inChipStudy: 'Ask Chip to quiz you on what you’re learning, or make flashcards from your notes. In Guide me mode, Chip asks what you think before it explains, so you’re recalling from the start.',
    sources: [
      'Roediger, H. L., & Karpicke, J. D. (2006). Test-enhanced learning: Taking memory tests improves long-term retention. Psychological Science, 17(3), 249–255.',
      'Karpicke, J. D., & Blunt, J. R. (2011). Retrieval practice produces more learning than elaborative studying with concept mapping. Science, 331(6018), 772–775.',
      'Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). Improving students’ learning with effective learning techniques. Psychological Science in the Public Interest, 14(1), 4–58.',
    ],
  },
  {
    slug: 'using-ai-without-cheating',
    title: 'Using AI for your studies without cheating',
    metaTitle: 'How to use AI for studying without cheating · Chip Study',
    description: 'Practical guidance on using AI tools honestly for coursework: know your course’s rules, use AI to learn rather than to write for you, check everything, and declare how you used it.',
    lead: 'AI can be a patient tutor or a way to hand in work that isn’t yours. The difference is who does the thinking, and whether you’re open about the help you had.',
    minutes: 6,
    sections: [
      {
        heading: 'First, know your course’s rules',
        body: [
          'There’s no single rule. Some courses welcome AI for feedback and planning, some allow it with a declaration, and some don’t allow it at all, sometimes for one assignment and not another.',
          [
            'Read your institution’s policy on AI and academic integrity.',
            'Read each assignment brief: it may say what’s allowed.',
            'If you’re not sure, ask your lecturer or teacher before you start, not after.',
          ],
          'When the rules say no, that’s the answer, however good the tool is.',
        ],
      },
      {
        heading: 'Uses that help you learn',
        body: [
          'Where your course allows it, these keep the thinking yours:',
          [
            'Explaining an idea in a different way, or with an example, until it clicks.',
            'Quizzing you on a topic, and telling you why an answer was wrong.',
            'Helping you understand what an assignment brief is really asking.',
            'Helping you plan your time and the structure of your work.',
            'Giving feedback on a draft you wrote: what’s unclear, what’s missing, how it measures against the rubric.',
            'Suggesting sources for you to find, read and judge yourself.',
          ],
        ],
      },
      {
        heading: 'Uses that cross the line',
        body: [
          [
            'Handing in text, code or answers the AI produced as if you wrote them.',
            'Using AI during an exam or test, unless you’ve been told you can.',
            'Paraphrasing AI writing so it doesn’t look like AI writing.',
            'Citing sources you haven’t read, or that the AI made up.',
          ],
          { tip: 'A simple test: could you explain and defend every sentence of your work without the AI in the room?' },
        ],
      },
      {
        heading: 'Keep your own voice',
        body: [
          'Write first, then ask for feedback. If you use an idea or a phrasing from an AI, rewrite it in your own words and make sure you understand it. Your lecturers want to see your thinking, including the parts that aren’t perfect yet.',
        ],
      },
      {
        heading: 'Check everything',
        body: [
          'AI tools can be confidently wrong. They can misstate facts, get calculations wrong, and produce references that look real but don’t exist. Check facts against your course materials, and find and read every source before you cite it.',
        ],
      },
      {
        heading: 'Be open about it',
        body: [
          'Some courses ask you to declare how you used AI. Even when yours doesn’t, keeping a note of what you asked and what you used makes it easy to answer honestly if anyone asks. A clear record protects you.',
          'Be careful what you paste in, too: don’t share other people’s personal details or material your course has asked you to keep private.',
        ],
      },
    ],
    inChipStudy: 'Chip Study is built for this. Chip guides and gives feedback first, respects your brief when it says AI mustn’t write for you, marks any words of Chip’s you put in your document until you rewrite them, and keeps an AI-use record of every bit of help that you can export as a declaration.',
    sources: [],
  },
];

export function guideBySlug(slug: string | undefined): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}
