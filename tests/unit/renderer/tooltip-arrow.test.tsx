import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ComponentType, ReactNode } from "react";

import * as primitives from "@workbench/ui/primitives/tooltip";

// The package's generated .d.ts types these as ref-only; they take children like any Radix part.
const { Tooltip, TooltipProvider } = primitives;
const TooltipTrigger = primitives.TooltipTrigger as ComponentType<{ children: ReactNode }>;
const TooltipContent = primitives.TooltipContent as ComponentType<{ children: ReactNode }>;

/**
 * The hint box has a border; its pointer is a square turned 45° that half overlaps the box. With
 * no border of its own it covered the box's border and left a notch instead of a pointer. Its two
 * outward edges carry the same border, so the outline runs on around the point.
 */
describe("tooltip pointer", () => {
  it("draws the box's border on the pointer's outward edges", () => {
    render(
      <TooltipProvider>
        <Tooltip open>
          <TooltipTrigger>Past documents</TooltipTrigger>
          <TooltipContent>Tech packs, brand books</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    const arrow = document.querySelector("[data-slot=tooltip-content] svg")!;
    expect(arrow).not.toBeNull();
    const classes = arrow.getAttribute("class") ?? "";
    expect(classes).toContain("border-r");
    expect(classes).toContain("border-b");
    expect(classes).toContain("border-border");
  });
});
