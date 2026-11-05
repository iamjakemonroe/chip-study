import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

/** The editor's two looks: Day, in Chip Study's own colours, and Night, dark with Kaivon's glow
 * (iris, sky, mint and amber). */

const base = (fontSize: number) =>
  EditorView.theme({
    '&': { fontSize: `${fontSize}px`, height: '100%', backgroundColor: 'transparent' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.65' },
    '.cm-content': { padding: '18px 0' },
    '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
    '&.cm-focused': { outline: 'none' },
    '.cm-tooltip': { borderRadius: '12px', overflow: 'hidden' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '2px 8px', fontFamily: 'var(--font-mono)' },
    '.cm-diagnostic': { padding: '6px 10px', fontFamily: 'var(--font-sans)', fontSize: '13px' },
    '.cm-unused': { opacity: '0.55' },
    '.cm-panels': { fontFamily: 'var(--font-sans)' },
  });

const day = EditorView.theme({
  '.cm-gutters': { color: '#a3a5bb' },
  '.cm-activeLine': { backgroundColor: 'rgb(100 87 240 / 0.05)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#6457f0' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgb(100 87 240 / 0.16) !important' },
  '.cm-cursor': { borderLeftColor: '#6457f0', borderLeftWidth: '2px' },
  '.cm-matchingBracket': { backgroundColor: 'rgb(100 87 240 / 0.14)', outline: '1px solid rgb(100 87 240 / 0.35)' },
  '.cm-tooltip': { border: '1px solid #e6e6f0', backgroundColor: '#fff', boxShadow: '0 18px 48px rgb(25 26 46 / 0.12)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#eeecff', color: '#191a2e' },
  '.cm-searchMatch': { backgroundColor: 'rgb(240 138 75 / 0.22)' },
  '.cm-panels': { backgroundColor: '#f7f7fb', color: '#191a2e', borderColor: '#e6e6f0' },
});

const dayInk = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#5b4ee6', fontWeight: '550' },
  { tag: [t.string, t.special(t.string), t.character], color: '#17845f' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#c25a17' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#8a8ca6', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: '#1c74b8' },
  { tag: [t.typeName, t.className, t.namespace], color: '#9a6c0e' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#191a2e' },
  { tag: [t.propertyName, t.attributeName], color: '#2b6b9e' },
  { tag: [t.tagName], color: '#c23a63' },
  { tag: [t.attributeValue], color: '#17845f' },
  { tag: [t.regexp, t.escape], color: '#b2416e' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#6c6e8a' },
  { tag: [t.heading], color: '#191a2e', fontWeight: '700' },
  { tag: [t.link, t.url], color: '#1c74b8', textDecoration: 'underline' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.meta, t.annotation, t.self], color: '#7a5cd6' },
  { tag: t.invalid, color: '#e5547a' },
]);

const night = EditorView.theme(
  {
    '&': { color: '#e4e5f4' },
    '.cm-gutters': { color: '#5d6084' },
    '.cm-activeLine': { backgroundColor: 'rgb(124 112 255 / 0.08)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#a99fff' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgb(124 112 255 / 0.3) !important' },
    '.cm-cursor': { borderLeftColor: '#a99fff', borderLeftWidth: '2px' },
    '.cm-matchingBracket': { backgroundColor: 'rgb(124 112 255 / 0.22)', outline: '1px solid rgb(124 112 255 / 0.5)' },
    '.cm-tooltip': { border: '1px solid #2c2e4f', backgroundColor: '#1b1c35', color: '#e4e5f4', boxShadow: '0 18px 48px rgb(0 0 0 / 0.45)' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#2f2a6b', color: '#fff' },
    '.cm-searchMatch': { backgroundColor: 'rgb(255 184 107 / 0.25)' },
    '.cm-panels': { backgroundColor: '#17182f', color: '#e4e5f4', borderColor: '#2c2e4f' },
    '.cm-panels input, .cm-panels button': { color: 'inherit' },
    '.cm-foldPlaceholder': { backgroundColor: '#24264a', border: 'none', color: '#a7aac6' },
  },
  { dark: true },
);

const nightInk = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#b9a8ff', fontWeight: '550' },
  { tag: [t.string, t.special(t.string), t.character], color: '#7fe0b4' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#ffb46b' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#6d7196', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: '#6fc8ff' },
  { tag: [t.typeName, t.className, t.namespace], color: '#ffd37a' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#f1f1fb' },
  { tag: [t.propertyName, t.attributeName], color: '#9cd6ff' },
  { tag: [t.tagName], color: '#ff8fb0' },
  { tag: [t.attributeValue], color: '#7fe0b4' },
  { tag: [t.regexp, t.escape], color: '#ff9ccb' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#a2a5c4' },
  { tag: [t.heading], color: '#ffffff', fontWeight: '700' },
  { tag: [t.link, t.url], color: '#6fc8ff', textDecoration: 'underline' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.meta, t.annotation, t.self], color: '#d0a8ff' },
  { tag: t.invalid, color: '#ff6b8f' },
]);

export function editorTheme(theme: 'day' | 'night', fontSize: number): Extension {
  return theme === 'night' ? [base(fontSize), night, syntaxHighlighting(nightInk)] : [base(fontSize), day, syntaxHighlighting(dayInk)];
}
