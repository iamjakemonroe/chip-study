import { site } from './site.ts';

/** A paragraph, or a list (an array of items). */
export type Block = string | string[];

export interface LegalDoc {
  slug: 'terms' | 'privacy';
  title: string;
  summary: string;
  updated: string;
  sections: { heading: string; body: Block[] }[];
}

const updated = '29 October 2026';
const contact = site.email;

export const terms: LegalDoc = {
  slug: 'terms',
  title: 'Terms of Service',
  summary: 'The rules for using Chip Study, including Chip, the AI study partner, and Chip Study Pro.',
  updated,
  sections: [
    {
      heading: 'Who we are',
      body: [
        `Chip Study, at ${site.host}, is made and run by Kaivon (“we”, “us”), the studio behind Utopia and Wavee. It’s a workspace for assignments, with Chip, an AI study partner. By using Chip Study you agree to these terms. If you don’t agree, please don’t use it.`,
      ],
    },
    {
      heading: 'Who can use it',
      body: [
        'You must be at least 13 years old. If you’re under 18, you need a parent or guardian’s permission, and they agree to these terms for you, including for any payment.',
      ],
    },
    {
      heading: 'Your account',
      body: [
        'Chip Study uses your Kaivon account: the same one you use in Utopia. You sign in with a code we email you. Keep access to your email to yourself; you’re responsible for what happens on your account. An account is for one person.',
      ],
    },
    {
      heading: 'Studying honestly',
      body: [
        'Chip is built to help you learn and do your own best work: it explains, plans, gives feedback, helps with sources and can draft text with you. Your school, college or university decides what help is allowed on your work. You’re responsible for following its rules on AI and on academic integrity.',
        [
          'Every way you use Chip on an assignment is kept in its AI-use record, which you can export as a declaration to hand in. You can’t edit the record, so it stays trustworthy; you can delete the whole assignment.',
          'Text you put into your document from Chip is marked as Chip’s until you rewrite it.',
          'Don’t use Chip during an exam or test you’re sitting, or to hand in work as your own where your course doesn’t allow AI help.',
        ],
      ],
    },
    {
      heading: 'Chip can be wrong',
      body: [
        'Chip’s answers are written by AI models (Claude, by Anthropic). They can be mistaken, out of date or incomplete. Check facts, quotes and sources before you rely on them; a source Chip couldn’t find on the web is marked for you to check. Chip’s feedback against a rubric is a guide, not a grade.',
      ],
    },
    {
      heading: 'Your work stays yours',
      body: [
        'What you write and add in Chip Study belongs to you. You let us store it and process it (including sending it to Chip’s AI provider to answer you) only so we can run the service for you. You may use what Chip writes for you, within your course’s rules.',
      ],
    },
    {
      heading: 'Chip time and fair use',
      body: [
        'Chip has a daily allowance of time, shown in the app. Short questions use less of it than long drafts. Free accounts get Chip Fast each day; Chip Study Pro adds Chip’s best model, web research and more. To keep Chip fast and affordable for everyone, we may adjust allowances, and Chip may ask everyone on the free plan to come back later on very busy days.',
      ],
    },
    {
      heading: 'Chip Study Pro, payments and refunds',
      body: [
        'Chip Study Pro costs US$7.99 a month (Flutterwave converts for cards in other currencies). It renews every month on the card you paid with until you cancel. Payments are processed securely by Flutterwave; we never see your full card details.',
        'Students get Pro for US$5.99 a month on an account made with a school email (such as .edu, .ac.uk or .edu.ng). It includes everything in Pro, with a smaller allowance of Chip’s best model, as the Plan page shows. It’s for current students: we may ask for proof that you study there. If an account on the student plan isn’t a student’s, we may end that plan after telling you; you keep Pro until the end of the month you’ve paid for, and can carry on at the full price.',
        [
          'Cancel any time on the Plan page: nothing more is charged, and you keep Pro until the end of the month you’ve paid for. Part-months aren’t refunded.',
          'Forgot to cancel? Write to us within 7 days of a renewal. If you haven’t used Chip’s best model since it renewed, we refund that renewal.',
          'Always refunded in full: a double charge, a payment where Pro never started and we can’t fix it, or a payment made without your permission.',
          'Refunds go back to the card you paid with, usually within 5 to 10 business days.',
          'If we change the price, we’ll tell you before your next renewal, and you can cancel before it applies.',
        ],
        `To ask for a refund, write to ${contact} with your account email, the date and amount, and the payment reference. Please contact us before a chargeback: it’s the fastest way to fix a problem.`,
      ],
    },
    {
      heading: 'Using it well',
      body: [
        [
          'Don’t use Chip Study for anything illegal, to harm others, or to make content that breaks Anthropic’s usage policies.',
          'Don’t try to get around the allowances, break or overload the service, or get at other people’s data.',
          'Don’t resell access to Chip Study or Chip.',
        ],
        'We may limit, suspend or close an account that breaks these rules.',
      ],
    },
    {
      heading: 'The service',
      body: [
        'Chip Study is provided “as is”. We work hard to keep it running, private and accurate, but we can’t promise it will always be available or free of errors. Keep copies of important work (you can export any document). As far as the law allows, we aren’t liable for indirect losses, and our total liability to you is limited to what you paid us in the 12 months before the claim. Nothing in these terms limits rights you have that can’t be limited by law.',
      ],
    },
    {
      heading: 'Governing law',
      body: [
        'These terms are governed by the laws of the Federal Republic of Nigeria, and disputes will be handled by the courts of Nigeria. Your rights under consumer protection law where you live aren’t affected. Before going to court, please contact us: most problems are solved quickly that way.',
      ],
    },
    {
      heading: 'Changes',
      body: ['We may update these terms. If a change matters, we’ll tell you in the app before it applies. The date at the top shows when they last changed.'],
    },
    {
      heading: 'Contact',
      body: [`Questions about these terms: ${contact}.`],
    },
  ],
};

export const privacy: LegalDoc = {
  slug: 'privacy',
  title: 'Privacy Policy',
  summary: 'What Chip Study keeps about you, why, who helps us run it, and how to delete it.',
  updated,
  sections: [
    {
      heading: 'Who we are',
      body: [
        `Kaivon runs Chip Study and is responsible for your information. We follow the Nigeria Data Protection Act 2023. Contact: ${contact}.`,
      ],
    },
    {
      heading: 'What we keep',
      body: [
        [
          'Your account: your email address, from your Kaivon account (shared with Utopia).',
          'Your study work: assignments, briefs and rubrics, documents, notes, sources, the text of readings you add, tasks and focus sessions.',
          'Your conversations with Chip, and each assignment’s AI-use record.',
          'Usage: how much Chip time you’ve used each day (numbers only), so the allowances work.',
          'Payments for Pro: what you bought and when, and Flutterwave’s reference. We never see your full card number.',
        ],
        'When you add a document (a PDF, or a Word, Excel, PowerPoint or other file), its text is taken out on your own device and only the text is kept. Macros in an Excel file are read as text, never run. If you ask Chip to read a scanned file or a photo, it’s sent to our AI provider for that one reading and not stored.',
      ],
    },
    {
      heading: 'How we use it',
      body: [
        'To run your workspace, to have Chip answer you, to keep your AI-use record, to keep the allowances fair, to take payments and give refunds, to offer the student price (we check whether your email’s domain is a school’s), to help you when you ask, and to keep the service safe and working. We don’t sell your information, we don’t show ads, and we don’t use your work to train AI models.',
      ],
    },
    {
      heading: 'Who helps us run it',
      body: [
        [
          'Anthropic writes Chip’s answers (Claude). To answer, Chip sends it your message, your assignment’s brief, rubric, sources and readings, your document and anything you selected. Anthropic doesn’t use it to train its models.',
          'Supabase hosts Chip Study’s servers and stores its data (in the European Union, Ireland).',
          'Cloudflare delivers the website and protects it from attacks.',
          'Flutterwave processes payments for Pro.',
          'Resend delivers the sign-in codes we email you.',
        ],
        'We may also share information when the law requires it, or to protect people and the service.',
      ],
    },
    {
      heading: 'On your device',
      body: [
        'Chip Study keeps your sign-in and preferences in your browser’s storage, and a copy of the document you’re writing until it’s saved, so nothing is lost if the connection drops. There are no advertising or tracking cookies and no analytics.',
      ],
    },
    {
      heading: 'Keeping and deleting it',
      body: [
        [
          'Delete an assignment, a document, a note or a source at any time: it’s gone at once, with everything in it.',
          'Settings › Delete all my study data removes every assignment, document, conversation and focus session you have in Chip Study, and keeps your Kaivon account.',
          'Deleting your Kaivon account (in Utopia: Settings › Delete account) deletes your Chip Study data too.',
        ],
        'Daily usage numbers and payment records are kept without your work, because fair use and our accounts rely on them.',
      ],
    },
    {
      heading: 'Your rights',
      body: [
        `You can ask to see, correct or delete your information, get a copy of it, or object to how we use it, by writing to ${contact}. You can also complain to the Nigeria Data Protection Commission.`,
      ],
    },
    {
      heading: 'Children',
      body: [
        'Chip Study isn’t meant for children under 13, and we don’t knowingly collect their information. If you believe a child under 13 is using it, contact us and we’ll delete the account.',
      ],
    },
    {
      heading: 'Changes',
      body: ['If we change this policy in a way that matters, we’ll tell you in the app first. The date at the top shows when it last changed.'],
    },
  ],
};
