import { toast } from '../store/toast.ts';

/** Copies [text], and says so (or says to copy it by hand when the browser won't). */
export async function copyText(text: string, said = 'Copied.'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(said, 'good');
  } catch {
    toast('Couldn’t copy. Select it and copy it yourself.', 'warn');
  }
}

/** Saves [csv] as a file (with a byte-order mark, so Excel reads accents and names right). */
export function downloadCsv(csv: string, name: string) {
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'invites.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
