import { create } from "zustand";

import { errorMessage } from "@shared/ipc/errors";

/**
 * Quick commands beside the chat (`/usage`, `/context`, `/btw`): what each composer's card
 * shows, by the composer's draft key. One per composer; a new one replaces the last, and an
 * answer for one already replaced or dismissed is dropped. Never written into a transcript or
 * kept across a relaunch (`SessionManager.aside` runs them on a process of their own).
 */
export type QuickCommandName = "usage" | "context" | "btw";

export type Aside = {
  id: number;
  command: QuickCommandName;
  /** `/btw`'s question, shown over its answer. */
  question: string | null;
  status: "running" | "done" | "error";
  markdown: string;
  error: string | null;
};

export type AsideRequest = {
  agentId: string;
  sessionId: string | null;
  projectId: string | null;
  command: QuickCommandName;
  question?: string;
};

type AsidesState = {
  asides: Record<string, Aside>;
  run: (key: string, request: AsideRequest) => void;
  dismiss: (key: string) => void;
};

let counter = 0;

export const useAsides = create<AsidesState>((set, get) => ({
  asides: {},

  run: (key, request) => {
    const id = ++counter;
    const aside: Aside = {
      id,
      command: request.command,
      question: request.question ?? null,
      status: "running",
      markdown: "",
      error: null,
    };
    set((state) => ({ asides: { ...state.asides, [key]: aside } }));
    const settle = (patch: Partial<Aside>) => {
      if (get().asides[key]?.id !== id) return;
      set((state) => ({ asides: { ...state.asides, [key]: { ...aside, ...patch } } }));
    };
    window.workbench.sessions
      .aside({ ...request, ...(request.question ? { question: request.question } : {}) })
      .then(
        ({ markdown }) => settle({ status: "done", markdown }),
        (error: unknown) => settle({ status: "error", error: errorMessage(error) }),
      );
  },

  dismiss: (key) =>
    set((state) => {
      const { [key]: _gone, ...rest } = state.asides;
      return { asides: rest };
    }),
}));
