import { toast } from '../store/toast.ts';
import { addSource } from './api.ts';
import type { Source } from './types.ts';

/** Adds [files] as readings on an assignment or topic, one after another: the text taken out of
 * each PDF, Word or text file, for Chip to read with the student (a long one cut to [maxChars]).
 * Says how it went; one without text is left out, and once the day's readings are used up the
 * rest are too. */
export async function addReadings(assignmentId: string, files: File[], maxChars: number): Promise<Source[]> {
  const { extractText, kindOf } = await import('./extract.ts');
  const added: Source[] = [];
  let missed: string | null = null;
  let cut = false;
  for (const file of files) {
    try {
      if (!['pdf', 'docx', 'text'].includes(kindOf(file))) throw new Error(`${file.name} isn’t a PDF, a Word file or text.`);
      const { text } = await extractText(file);
      if (text.trim().length < 20) throw new Error(`No text in ${file.name} (is it a scan?). Paste its text into a note instead.`);
      if (text.length > maxChars) cut = true;
      const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
      added.push(await addSource(assignmentId, { kind: 'other', data: { title }, content: text.slice(0, maxChars), file_name: file.name }));
    } catch (e) {
      missed ??= (e as Error).message || `Couldn’t read ${file.name}.`;
      // Today's readings are used up: the rest would be refused too.
      if (/today’s readings/.test(missed)) break;
    }
  }
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
