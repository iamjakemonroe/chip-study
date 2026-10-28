import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Sigma,
  Strikethrough,
  Table2,
  Underline,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Menu, MenuItem } from '../components/ui.tsx';

/** The document's tools. It re-draws only when what's active changes, not on every keystroke. */
export function Toolbar({ editor, onLink, onMath, onCite }: { editor: Editor; onLink: () => void; onMath: (kind: 'inline' | 'block') => void; onCite: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      highlight: e.isActive('highlight'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      code: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
      center: e.isActive({ textAlign: 'center' }),
      justify: e.isActive({ textAlign: 'justify' }),
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();

  return (
    <div className="no-scrollbar flex items-center gap-0.5 overflow-x-auto px-1" role="toolbar" aria-label="Formatting">
      <Tool label="Undo" onClick={() => c().undo().run()} disabled={!s.undo}>
        <Undo2 size={17} />
      </Tool>
      <Tool label="Redo" onClick={() => c().redo().run()} disabled={!s.redo}>
        <Redo2 size={17} />
      </Tool>
      <Divider />
      <Tool label="Heading 1" active={s.h1} onClick={() => c().toggleHeading({ level: 1 }).run()}>
        <Heading1 size={18} />
      </Tool>
      <Tool label="Heading 2" active={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}>
        <Heading2 size={18} />
      </Tool>
      <Tool label="Heading 3" active={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}>
        <Heading3 size={18} />
      </Tool>
      <Divider />
      <Tool label="Bold" shortcut="⌘B" active={s.bold} onClick={() => c().toggleBold().run()}>
        <Bold size={17} />
      </Tool>
      <Tool label="Italic" shortcut="⌘I" active={s.italic} onClick={() => c().toggleItalic().run()}>
        <Italic size={17} />
      </Tool>
      <Tool label="Underline" shortcut="⌘U" active={s.underline} onClick={() => c().toggleUnderline().run()}>
        <Underline size={17} />
      </Tool>
      <Tool label="Strikethrough" active={s.strike} onClick={() => c().toggleStrike().run()}>
        <Strikethrough size={17} />
      </Tool>
      <Tool label="Highlight" active={s.highlight} onClick={() => c().toggleHighlight().run()}>
        <Highlighter size={17} />
      </Tool>
      <Tool label="Link" active={s.link} onClick={onLink}>
        <Link2 size={17} />
      </Tool>
      <Divider />
      <Tool label="Bulleted list" active={s.bullet} onClick={() => c().toggleBulletList().run()}>
        <List size={18} />
      </Tool>
      <Tool label="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered size={18} />
      </Tool>
      <Tool label="Quote" active={s.quote} onClick={() => c().toggleBlockquote().run()}>
        <Quote size={17} />
      </Tool>
      <Tool label="Code block" active={s.code} onClick={() => c().toggleCodeBlock().run()}>
        <Code2 size={17} />
      </Tool>
      <Tool label={s.center ? 'Justify' : s.justify ? 'Align left' : 'Centre'} onClick={() => c().setTextAlign(s.center ? 'justify' : s.justify ? 'left' : 'center').run()} active={s.center || s.justify}>
        {s.center ? <AlignCenter size={17} /> : s.justify ? <AlignJustify size={17} /> : <AlignLeft size={17} />}
      </Tool>
      <Divider />
      <Menu label="Math" button={<Sigma size={17} />} align="left">
        {(close) => (
          <>
            <MenuItem onClick={() => (close(), onMath('inline'))}>Math in the line</MenuItem>
            <MenuItem onClick={() => (close(), onMath('block'))}>Math on its own line</MenuItem>
          </>
        )}
      </Menu>
      <Menu label="Table" button={<Table2 size={17} />} align="left">
        {(close) => (
          <>
            {!s.table && (
              <MenuItem onClick={() => (close(), c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>Insert a table</MenuItem>
            )}
            {s.table && (
              <>
                <MenuItem onClick={() => (close(), c().addRowAfter().run())}>Add a row</MenuItem>
                <MenuItem onClick={() => (close(), c().addColumnAfter().run())}>Add a column</MenuItem>
                <MenuItem onClick={() => (close(), c().deleteRow().run())}>Delete this row</MenuItem>
                <MenuItem onClick={() => (close(), c().deleteColumn().run())}>Delete this column</MenuItem>
                <MenuItem onClick={() => (close(), c().toggleHeaderRow().run())}>Header row on or off</MenuItem>
                <MenuItem danger onClick={() => (close(), c().deleteTable().run())}>
                  Delete the table
                </MenuItem>
              </>
            )}
          </>
        )}
      </Menu>
      <Tool label="Horizontal line" onClick={() => c().setHorizontalRule().run()}>
        <Minus size={17} />
      </Tool>
      <button className="ml-1 flex h-8 flex-none items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-ink-2 hover:bg-paper-2 hover:text-ink" onClick={onCite}>
        <span className="font-serif text-[0.95rem] italic">“”</span> Cite
      </button>
    </div>
  );
}

function Tool({ label, shortcut, active, disabled, onClick, children }: { label: string; shortcut?: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="icon-btn h-8 w-8 flex-none rounded-lg disabled:opacity-35"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active ?? undefined}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px flex-none bg-line" aria-hidden="true" />;
}
