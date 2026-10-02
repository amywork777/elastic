/**
 * `onboarding.*`: what the first-run flow needs from main.
 *
 * Whether the person has finished the welcome, dismissed the checklist or
 * opened the viewer is ordinary settings (`onboarding*` fields in
 * `SettingsSchema`). This is the part that is not a setting: whether
 * this run shows onboarding at all.
 */
import { z } from "zod";

import { invoke } from "./define";

export const OnboardingStatusSchema = z.object({
  /**
   * False under the test suites (`NODE_ENV=test`), whose fresh profiles would
   * otherwise open on the welcome instead of the screen they test.
   * `WORKBENCH_ONBOARDING=1` turns it back on for a test that wants the welcome.
   */
  enabled: z.boolean(),
});
export type OnboardingStatus = z.infer<typeof OnboardingStatusSchema>;

export const onboardingContract = {
  onboarding: {
    status: invoke(z.void(), OnboardingStatusSchema),
  },
} as const;
