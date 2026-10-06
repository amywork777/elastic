import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Tailwind generates only the classes it finds in the files `@source` names. A path that points
 * nowhere is not an error to Tailwind: the classes in it are simply never made. That is how chat
 * replies lost their list bullets and heading sizes: Streamdown's `@source` climbed five levels
 * from `src/renderer/styles` (a layout this app left behind) to a `node_modules` that is not there.
 */
const root = path.resolve(__dirname, "../../..");
const stylesheets = ["src/renderer/styles/globals.css", "packages/ui/src/styles/globals.css"];

describe("Tailwind @source paths", () => {
  for (const sheet of stylesheets) {
    it(`every @source in ${sheet} names something that exists`, () => {
      const file = path.join(root, sheet);
      const css = fs.readFileSync(file, "utf8");
      const sources = [...css.matchAll(/@source\s+"([^"]+)"/g)].map((match) => match[1]!);
      expect(sources.length).toBeGreaterThan(0);
      const missing = sources.filter((source) => {
        // A glob's directory is what has to be there; Tailwind expands the pattern inside it.
        const target = path.resolve(path.dirname(file), source.includes("*") ? path.dirname(source) : source);
        return !fs.existsSync(target);
      });
      expect(missing).toEqual([]);
    });
  }
});
