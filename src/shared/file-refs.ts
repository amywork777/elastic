/**
 * The file reference grammar: `<file>#<fragment>`, either half optional:
 * `docs/plan.md#L12`, `models/part.step#o1.2`, `#o1`, or a bare `notes.txt`.
 *
 * The app does not interpret a fragment. It is handed, as typed, to the
 * renderer showing the file (the plugin that owns the format), which decides
 * what `#o1.2` or `#L12` points at. Which files count as "pointable" — a word
 * the composer turns into a chip — is the set of extensions enabled plugins
 * register (`registerReferenceExtensions`); with no plugin, only a word with
 * an explicit fragment is a reference. Pure, so links, chips and tests share it.
 */

const PART = "[A-Za-z0-9_][A-Za-z0-9_.:-]*";
/** One fragment, or a comma-separated list; the source of every regex below. */
export const FRAGMENT_SOURCE = `${PART}(?:,${PART})*`;
const FRAGMENT_RE = new RegExp(`^${FRAGMENT_SOURCE}$`);

/** Is this the fragment half of a reference — what follows the `#`? */
export function isFragment(candidate: string): boolean {
  return FRAGMENT_RE.test(candidate);
}

/** Lowercase extension without the dot, `""` when there is none. */
export function extensionOf(file: string): string {
  const name = file.split("/").pop() ?? file;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

const referenceExtensions = new Map<string, number>();

/** A plugin's formats become reference hosts while it is enabled; returns the removal. */
export function registerReferenceExtensions(extensions: readonly string[]): () => void {
  const normalized = [...new Set(extensions.map((extension) => extension.replace(/^\./, "").toLowerCase()).filter(Boolean))];
  for (const extension of normalized) referenceExtensions.set(extension, (referenceExtensions.get(extension) ?? 0) + 1);
  return () => {
    for (const extension of normalized) {
      const count = (referenceExtensions.get(extension) ?? 1) - 1;
      if (count > 0) referenceExtensions.set(extension, count);
      else referenceExtensions.delete(extension);
    }
  };
}

/** Is this a file a plugin renders and can point into (its fragments mean something)? */
export function isReferenceFile(file: string): boolean {
  return referenceExtensions.has(extensionOf(file));
}

export type FileReference = {
  /** Root-relative path, `""` for a bare fragment. */
  file: string;
  /** The fragment without its `#`, `""` for a bare file. */
  selector: string;
  /** Optional display name from the renderer; never changes the prompt token. */
  label?: string;
};

/**
 * Split `file#fragment` into its halves. Null when the text is not a
 * reference: a `#` with something other than a fragment after it, or
 * nothing on either side.
 */
export function splitReference(text: string): FileReference | null {
  // JSON-quoted file paths keep whitespace and literal '#' characters intact.
  if (text.startsWith('"')) {
    const quoted = text.match(/^("(?:[^"\\\r\n]|\\.)*")(.*)$/);
    if (!quoted) return null;
    let file: string;
    try { file = JSON.parse(quoted[1]!); } catch { return null; }
    const tail = quoted[2]!;
    if (!tail) return file ? { file, selector: "" } : null;
    return tail.startsWith("#") && isFragment(tail.slice(1)) ? { file, selector: tail.slice(1) } : null;
  }
  const hash = text.indexOf("#");
  if (hash < 0) {
    return text ? { file: text, selector: "" } : null;
  }
  const file = text.slice(0, hash);
  const selector = text.slice(hash + 1);
  if (!isFragment(selector) || text.indexOf("#", hash + 1) >= 0) {
    return null;
  }
  return { file, selector };
}

/** The plain text form: `file#fragment`, `#fragment`, or `file`. */
export function referenceText(reference: FileReference): string {
  const file = /[\s#"\\]/.test(reference.file) ? JSON.stringify(reference.file) : reference.file;
  return reference.selector ? `${file}#${reference.selector}` : file;
}
