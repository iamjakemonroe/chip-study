import { toast } from '../store/toast.ts';
import { addSource } from './api.ts';
import type { Me, Source } from './types.ts';

type Text = { file: File; text: string };

/** Adds [files] as readings on an assignment or topic, one after another: the text taken out of
 * each PDF, Word or text file, for Chip to read with the student (a long one cut to [maxChars]).
 * Says how it went; one without text is left out, and once the day's readings are used up the
 * rest are too. */
export async function addReadings(assignmentId: string, files: File[], maxChars: number): Promise<Source[]> {
  const { extractText, kindOf } = await import('./extract.ts');
  const texts: Text[] = [];
  let missed: string | null = null;
  for (const file of files) {
    try {
      if (!['pdf', 'docx', 'text'].includes(kindOf(file))) throw new Error(`${file.name} isn’t a PDF, a Word file or text.`);
      const { text } = await extractText(file);
      if (text.trim().length < 20) throw new Error(`No text in ${file.name} (is it a scan?). Paste its text into a note instead.`);
      texts.push({ file, text });
    } catch (e) {
      missed ??= (e as Error).message || `Couldn’t read ${file.name}.`;
    }
  }
  const { added, missed: refused, cut } = await saveReadings(assignmentId, texts, maxChars);
  missed ??= refused;
  const long = cut ? ` ${files.length > 1 ? 'Long ones are' : 'It was long, so it’s'} cut to the first ${maxChars.toLocaleString()} characters.` : '';
  if (!added.length) {
    if (missed) toast(missed, 'warn');
  } else if (missed) {
    toast(`Added ${added.length} of ${files.length} readings. ${missed}`, 'warn');
  } else {
    toast(`${added.length === 1 ? 'Reading added. Chip can read it with you now.' : `${added.length} readings added. Chip can read them with you now.`}${long}`, 'good');
  }
  return added;
}

/** Saves [texts] as readings, one after another, until the day's readings are used up. */
async function saveReadings(assignmentId: string, texts: Text[], maxChars: number): Promise<{ added: Source[]; missed: string | null; cut: boolean }> {
  const added: Source[] = [];
  let missed: string | null = null;
  let cut = false;
  for (const { file, text } of texts) {
    try {
      if (text.length > maxChars) cut = true;
      const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      added.push(await addSource(assignmentId, { kind: 'other', data: { title }, content: text.slice(0, maxChars), file_name: file.name }));
    } catch (e) {
      missed = (e as Error).message || `Couldn’t add ${file.name}.`;
      break;
    }
  }
  return { added, missed, cut };
}

/** A scan or photo for Chip to read with one message. */
export type ChatFile = { name: string; media_type: string; data: string };

/** Files attached to a message to Chip: documents with text are saved as readings (so Chip keeps
 * them for the rest of the work, and they're in Sources), and scans and photos go with the
 * message for Chip to read now. Up to 3 at once, or 10 with Pro, within the plan's upload size. */
export async function prepareAttachments(assignmentId: string, files: File[], me: Me | null): Promise<{ files: ChatFile[]; attached: string[]; saved: Source[] }> {
  const most = me?.tier === 'pro' ? 10 : 3;
  if (files.length > most) throw new Error(`Chip reads up to ${most} files at once${me?.tier === 'pro' ? '' : ' (10 with Pro)'}.`);
  const { extractText, base64Of, mediaType, kindOf } = await import('./extract.ts');
  const max = (me?.uploads.max_mb ?? 4) * 1024 * 1024;
  const texts: Text[] = [];
  const scans: ChatFile[] = [];
  let bytes = 0;
  for (const file of files) {
    const kind = kindOf(file);
    if (kind === 'other') throw new Error(`${file.name}: Chip reads PDFs, Word files (.docx), text and photos.`);
    if (kind !== 'image') {
      const { text } = await extractText(file);
      if (text.trim().length >= 40) {
        texts.push({ file, text });
        continue;
      }
      if (kind !== 'pdf') throw new Error(`No text in ${file.name}.`);
    }
    // A scan or a photo: Chip reads the file itself.
    bytes += file.size;
    if (bytes > max) throw new Error(`Those files are over ${me?.uploads.max_mb ?? 4} MB together${me?.tier === 'pro' ? '' : ' (20 MB with Pro)'}. Try fewer or smaller ones.`);
    scans.push({ name: file.name, media_type: mediaType(file), data: await base64Of(file) });
  }
  const { added, missed } = await saveReadings(assignmentId, texts, me?.readings.max_chars ?? 60000);
  if (missed) toast(`${missed} Chip reads what made it.`, 'warn');
  return { files: scans, attached: added.map((s) => s.file_name ?? s.data.title ?? 'a reading'), saved: added };
}
