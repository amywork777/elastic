import { fileURLToPath } from 'node:url';
import { buildLibrary } from '../../build-library.mjs';
await buildLibrary(fileURLToPath(new URL('..', import.meta.url)), { css: true });
