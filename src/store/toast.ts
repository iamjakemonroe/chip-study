import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'warn';
  action?: { label: string; run: () => void };
}

interface ToastState {
  toasts: Toast[];
  show: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void;
  dismiss: (id: number) => void;
}

let next = 1;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  show: (text, tone = 'info', action) => {
    const id = next++;
    set({ toasts: [...get().toasts.slice(-2), { id, text, tone, action }] });
    setTimeout(() => get().dismiss(id), action ? 7000 : 4200);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (text: string, tone?: Toast['tone'], action?: Toast['action']) => useToasts.getState().show(text, tone, action);
