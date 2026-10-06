/** Two chats side by side: the split in the sessions store (`docs/design.md`, "Two chats side by side"). */
import { beforeEach, describe, expect, it } from "vitest";
import { sessionsOnScreen, useSessions } from "@renderer/state/sessions";

const s = () => useSessions.getState();
const rows = (...ids: string[]) => ids.map((id) => ({ id, projectId: "p", archived: false })) as never;
beforeEach(() => useSessions.setState({ sessions: rows("a", "b", "c"), activeId: "a", split: null }));

describe("two chats side by side", () => {
  it("opens a chat beside the current one and focuses it", () => {
    s().openBeside("b");
    expect(s().split).toEqual({ left: "a", right: "b", focus: "right" });
    expect(s().activeId).toBe("b");
    expect(sessionsOnScreen(s())).toEqual(["a", "b"]);
  });
  it("moves focus to a chat already on the other side instead of showing it twice", () => {
    s().openBeside("b");
    s().select("a");
    expect(s().split).toEqual({ left: "a", right: "b", focus: "left" });
    expect(s().activeId).toBe("a");
    s().openBeside("b");
    expect(s().split).toEqual({ left: "a", right: "b", focus: "right" });
  });
  it("replaces the focused side when another chat is picked", () => {
    s().openBeside("b");
    s().select("c");
    expect(s().split).toEqual({ left: "a", right: "c", focus: "right" });
  });
  it("opens beside into the other side when already split", () => {
    s().openBeside("b");
    s().focusSide("left");
    s().openBeside("c");
    expect(s().split).toEqual({ left: "a", right: "c", focus: "right" });
  });
  it("does nothing when asked to open the only chat beside itself", () => {
    s().openBeside("a");
    expect(s().split).toBeNull();
    expect(s().activeId).toBe("a");
  });
  it("shows the new-chat screen in the focused side, and the created chat lands there", () => {
    s().openBeside("b");
    s().setActive(null);
    expect(s().split).toEqual({ left: "a", right: null, focus: "right" });
    expect(s().activeId).toBeNull();
    s().setActive("c");
    expect(s().split).toEqual({ left: "a", right: "c", focus: "right" });
  });
  it("closes a side and keeps the other", () => {
    s().openBeside("b");
    s().closeSide("right");
    expect(s().split).toBeNull();
    expect(s().activeId).toBe("a");
    s().openBeside("b");
    s().closeSide("left");
    expect(s().split).toBeNull();
    expect(s().activeId).toBe("b");
  });
  it("closes the side of a chat that is deleted or archived elsewhere", () => {
    s().openBeside("b");
    s().receive(rows("a", "c"));
    expect(s().split).toBeNull();
    expect(s().activeId).toBe("a");
    s().openBeside("c");
    s().receive([{ id: "a", projectId: "p", archived: true }, { id: "c", projectId: "p", archived: false }] as never);
    expect(s().split).toBeNull();
    expect(s().activeId).toBe("c");
  });
  it("closes the side of a chat deleted or archived from here", async () => {
    s().openBeside("b");
    await s().remove("b");
    expect(s().split).toBeNull();
    expect(s().activeId).toBe("a");
    s().openBeside("c");
    await s().archive("a", true);
    expect(s().split).toBeNull();
    expect(s().activeId).toBe("c");
  });
});

describe("two chats side by side, from history and links", () => {
  it("moves focus instead of showing a chat twice when it is set active from elsewhere (back/forward, continued-in links)", () => {
    s().openBeside("b");
    s().focusSide("left");
    s().setActive("b");
    expect(s().split).toEqual({ left: "a", right: "b", focus: "right" });
    expect(s().activeId).toBe("b");
  });
});

describe("a side on the new-chat screen", () => {
  it("keeps its own folder when focus moves to a chat in another one, and gets it back on return", async () => {
    const { useProjects } = await import("@renderer/state/projects");
    const folder = { id: "q", name: "Q", path: "/q" } as never;
    useSessions.setState({ sessions: [{ id: "a", projectId: "p", archived: false }, { id: "b", projectId: "p", archived: false }] as never });
    useProjects.setState({ projects: [{ id: "p", name: "P", path: "/p" }] as never, activeId: "p", draft: null });
    s().openBeside("b");
    s().setActive(null);
    useProjects.getState().selectDirectory(folder); // a folder just opened: a draft project
    s().focusSide("left");
    expect(s().splitProjects.right).toEqual(folder);
    expect(useProjects.getState().activeId).toBe("p");
    s().focusSide("right");
    expect(useProjects.getState().activeId).toBe("q");
    expect(useProjects.getState().draft).toEqual(folder);
  });

  it("receives the chat it created even when focus has moved to the other side meanwhile", () => {
    s().openBeside("b");
    s().setActive(null);
    s().focusSide("left");
    s().placeInSide("right", "c");
    expect(s().split).toEqual({ left: "a", right: "c", focus: "left" });
    expect(s().activeId).toBe("a");
  });
});

describe("a side hidden for want of room", () => {
  it("is not on screen: it is neither marked read nor shown as current", () => {
    s().openBeside("b");
    s().setSplitCollapsed(true);
    expect(sessionsOnScreen(s())).toEqual(["b"]);
    s().setSplitCollapsed(false);
    expect(sessionsOnScreen(s())).toEqual(["a", "b"]);
  });
});
