/**
 * Handlers for `onboarding.*` (src/shared/ipc/onboarding.ts).
 */
import type { IpcHandlers } from "../../shared/ipc";
import type { onboardingContract } from "../../shared/ipc/onboarding";
import { onboardingEnabled } from "../onboarding";
import type { IpcContext } from "./register";

export const onboardingHandlers = {
  onboarding: {
    status: () => ({ enabled: onboardingEnabled() }),
  },
} satisfies IpcHandlers<typeof onboardingContract, IpcContext>;
