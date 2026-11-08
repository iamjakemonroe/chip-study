import type { AnyExtension } from '@tiptap/core';
import type { Extension as CMExtension } from '@codemirror/state';
import { createContext, useContext } from 'react';
import type { Mode } from '../lib/types.ts';

/** How the workspace's editors work inside a study room. Outside a room there is none, and every
 * editor works exactly as it always has (saving to the assignment itself). Inside one, the shared
 * document (Yjs) is the source of truth, the room server saves it, and the editors are bound to it
 * live. This file has no Yjs in it: the room's code builds the binding, so the workspace doesn't
 * load any of it unless someone is in a room. */

export interface RoomSheet {
  read(): string[][];
  header(): boolean;
  setCell(r: number, c: number, value: string): void;
  addRow(): void;
  addColumn(): void;
  removeRow(): void;
  removeColumn(): void;
  setHeader(on: boolean): void;
  /** Calls back when the sheet changes (from anyone); answers a function that stops. */
  watch(onChange: () => void): () => void;
}

export interface RoomCode {
  text: string;
  lang: string | undefined;
  stdin: string | undefined;
  extension: CMExtension;
  setLang(lang: string): void;
  setStdin(stdin: string): void;
}

/** Notes' bodies and tasks' titles are shared texts: an edit is the change someone made (from the
 * text they saw to their new text), merged with anyone else's, never the whole text written back. */
export interface RoomLists {
  addNote(body: string): void;
  editNoteBody(id: string, from: string, to: string): void;
  updateNote(id: string, patch: { pinned?: boolean }): void;
  removeNote(id: string): void;
  addTasks(tasks: { title: string; due: string | null }[]): void;
  editTaskTitle(id: string, from: string, to: string): void;
  updateTask(id: string, patch: { due_on?: string | null; done?: boolean }): void;
  removeTask(id: string): void;
}

export interface RoomBinding {
  /** Changes each time the shared document is started afresh: editors are made again. */
  key: number;
  canEdit: boolean;
  docExtensions(id: string): AnyExtension[];
  /** A code document bound live (call once per editor). */
  code(id: string): RoomCode;
  /** Another code document's text as it is now (for running a project). */
  codeText(id: string): string;
  sheet(id: string): RoomSheet;
  lists: RoomLists;
  rename(id: string, title: string): void;
  /** Asks the room's shared Chip. */
  askChip(mode: Mode, text: string, selection?: string): void;
}

export const RoomBindingContext = createContext<RoomBinding | null>(null);

/** The room the workspace is in, or null outside one. */
export const useRoomBinding = (): RoomBinding | null => useContext(RoomBindingContext);
