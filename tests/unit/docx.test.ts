import { describe, expect, it } from 'vitest';
import { docxText, readZipEntry } from '../../src/lib/zip.ts';
import { zip } from './zip_fixture.ts';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docXml = `<?xml version="1.0"?><w:document ${W}><w:body>
<w:p><w:r><w:t>Assignment 2: Coastal</w:t></w:r><w:r><w:t xml:space="preserve"> erosion</w:t></w:r></w:p>
<w:p><w:r><w:t>Word count:</w:t><w:tab/><w:t>1,500</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Criterion</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Weight</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Argument</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>40%</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>Line one</w:t><w:br/><w:t>line two</w:t></w:r></w:p>
</w:body></w:document>`;

describe('reading Word files', () => {
  it('finds and inflates an entry', async () => {
    const z = zip({ 'a.txt': 'hello', 'word/document.xml': 'x'.repeat(500) });
    expect(await readZipEntry(z, 'a.txt')).toBe('hello');
    expect(await readZipEntry(z, 'word/document.xml')).toBe('x'.repeat(500));
    expect(await readZipEntry(z, 'missing')).toBeNull();
    expect(await readZipEntry(zip({ 'a.txt': 'stored' }, true), 'a.txt')).toBe('stored');
  });
  it('takes paragraphs, tabs, breaks and tables out of a .docx', async () => {
    const text = await docxText(zip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': docXml }));
    expect(text).toBe('Assignment 2: Coastal erosion\nWord count:\t1,500\nCriterion\tWeight\nArgument\t40%\nLine one\nline two');
  });
  it('says so when it isn’t a Word file', async () => {
    await expect(docxText(zip({ 'other.xml': '<x/>' }))).rejects.toThrow('Word document');
    await expect(docxText(new TextEncoder().encode('not a zip').buffer)).rejects.toThrow();
  });
});
