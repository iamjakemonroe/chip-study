import { describe, expect, it } from 'vitest';
import { freeName, langFromName, langById, renameForLang } from '../../src/workspace/code/langs.ts';
import { buildPage, cleanTraceback, findModule, pageFor, rewriteImports, show } from '../../src/workspace/code/project.ts';

describe('file names and languages', () => {
  it('reads the language from the extension', () => {
    expect(langFromName('index.html')?.id).toBe('html');
    expect(langFromName('Main.JAVA')?.id).toBe('java');
    expect(langFromName('helper.py ')?.id).toBe('python');
    expect(langFromName('notes')).toBeNull();
  });

  it('swaps a code extension for the new language, and leaves other names alone', () => {
    expect(renameForLang('main.py', langById('javascript'))).toBe('main.js');
    expect(renameForLang('main.py', langById('python'))).toBe('main.py');
    expect(renameForLang('My code', langById('javascript'))).toBe('My code');
  });

  it('finds a free name', () => {
    expect(freeName('main.py', ['Draft'])).toBe('main.py');
    expect(freeName('main.py', ['main.py', 'MAIN-2.py'])).toBe('main-3.py');
    expect(freeName('Makefile', ['makefile'])).toBe('Makefile-2');
  });
});

describe('a web page from the project', () => {
  const page = { name: 'index.html', code: '<html><head><link rel="stylesheet" href="./style.css"></head><body><script src="script.js"></script><script src="https://cdn.example/x.js"></script></body></html>' };
  const css = { name: 'style.css', code: 'h1 { color: red }' };
  const js = { name: 'script.js', code: 'console.log("</script>")' };
  const files = [page, css, js];

  it('writes in its stylesheet and script, and leaves outside ones', () => {
    const html = buildPage(files, page, 'BRIDGE');
    expect(html).toContain('<style data-file="style.css">\nh1 { color: red }\n</style>');
    expect(html).toContain('<script data-file="script.js">\nconsole.log("<\\/script>")\n//# sourceURL=script.js\n</script>');
    expect(html).toContain('src="https://cdn.example/x.js"');
    expect(html.indexOf('<script>BRIDGE</script>')).toBeLessThan(html.indexOf('<style'));
  });

  it('works on a fragment with no head', () => {
    expect(buildPage(files, { name: 'a.html', code: '<h1>Hi</h1>' }, 'B')).toBe('<script>B</script><h1>Hi</h1>');
  });

  it('shows the page that uses a stylesheet or script', () => {
    expect(pageFor(files, css)).toBe(page);
    expect(pageFor(files, js)).toBe(page);
    expect(pageFor(files, { name: 'other.js', code: '' })).toBeNull();
    expect(pageFor([css], css)).toBeNull();
  });
});

describe('JavaScript modules', () => {
  const files = [
    { name: 'main.js', code: '' },
    { name: 'math.ts', code: '' },
  ];

  it('finds a module with or without its extension', () => {
    expect(findModule(files, './math')?.name).toBe('math.ts');
    expect(findModule(files, './main.js')?.name).toBe('main.js');
    expect(findModule(files, 'lodash')).toBeNull();
  });

  it('points relative imports where it is told, and leaves the rest', () => {
    const code = `import { add } from './math';\nimport './setup.js';\nexport * from "./math";\nconst m = await import('./math');\nimport x from 'https://esm.sh/x';`;
    const out = rewriteImports(code, (spec) => (spec === './math' ? 'blob:1' : null));
    expect(out).toBe(`import { add } from 'blob:1';\nimport './setup.js';\nexport * from "blob:1";\nconst m = await import('blob:1');\nimport x from 'https://esm.sh/x';`);
  });
});

describe('output', () => {
  it('shows values the way a console does', () => {
    expect(show('hi')).toBe('hi');
    expect(show([1, 'a', null])).toBe('[ 1, "a", null ]');
    expect(show({ a: 1, 'b c': [] })).toBe('{ a: 1, "b c": [] }');
    expect(show(new Map([['k', 2]]))).toBe('Map(1) { "k" => 2 }');
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(show(loop)).toBe('{ self: [Circular] }');
  });

  it('keeps only the student’s frames in a Python traceback', () => {
    const tb = [
      'Traceback (most recent call last):',
      '  File "/lib/python314.zip/_pyodide/_base.py", line 597, in eval_code_async',
      '    await CodeRunner(',
      '  File "main.py", line 2, in <module>',
      '    print(1/0)',
      '          ~^~',
      'ZeroDivisionError: division by zero',
    ].join('\n');
    expect(cleanTraceback(tb)).toBe(['Traceback (most recent call last):', '  File "main.py", line 2, in <module>', '    print(1/0)', '          ~^~', 'ZeroDivisionError: division by zero'].join('\n'));
  });
});
