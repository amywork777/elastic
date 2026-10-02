import { createElement } from 'react';
import Overlay from './status/ViewerLoadingOverlay.js';

export { default as MissingFileAlert } from './status/MissingFileAlert.js';
export type { MissingFileAlertProps } from './status/MissingFileAlert.js';

export interface CadArtifactProgress {
  phase: string;
  label: string;
  detail: string;
  index: number;
  count: number;
  done: number;
  total: number | null;
  determinate: boolean;
  updatedAt: number;
}
export interface ViewerLoadingOverlayProps {
  viewerLoading: boolean;
  progress?: CadArtifactProgress | null;
}
/** The viewer's loading artwork, available before loading the renderer. */
export function ViewerLoadingOverlay({ viewerLoading, progress }: ViewerLoadingOverlayProps) {
  return createElement(Overlay, { loading: { opening: viewerLoading, headline: "Opening file", progress }, operationKey: "preparing-document" });
}
