/**
 * The default `window.workbench` mocks in tests/setup-jsdom.ts stand in for
 * main's answers; one that no longer matches its response schema lets a
 * renderer test pass against a shape main can never send.
 */
import { expect, it } from "vitest";

import { GitStatusSchema } from "@shared/ipc/git";

it("the default git.status mock matches GitStatusSchema", async () => {
  const answer: unknown = await window.workbench.git.status({ projectId: "p" } as never);
  expect(GitStatusSchema.safeParse(answer).success).toBe(true);
});
