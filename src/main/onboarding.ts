/**
 * The first-run flow's main-side piece: whether this run shows it.
 */
export function onboardingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== "test" || env.WORKBENCH_ONBOARDING === "1";
}
