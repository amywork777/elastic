import type { ReactNode } from 'react';

export interface EmptyCadBackdropProps {
  colorScheme?: 'light' | 'dark';
  children?: ReactNode;
}

/** The host's empty stage: a plain backdrop with whatever the host puts on it. */
export function EmptyCadBackdrop({ children }: EmptyCadBackdropProps) {
  return <div className="relative h-full w-full bg-muted/30">{children}</div>;
}
