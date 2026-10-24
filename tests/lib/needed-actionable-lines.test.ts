import { expect, it } from "vitest";
import { parseNeeded, neededTodoItems, removeNeededLine, removeNeededLines, assigneeForTodo } from "@/lib/needed";
import type { GithubRepo } from "@/lib/github";
const repo = { id: 123, owner: "owner", name: "fixture" } as GithubRepo;
it.each(["```markdown", "~~~markdown", "````markdown"])("does not import examples inside %s fences", fence => {
  const marker = fence.startsWith("~") ? "~~~" : fence.startsWith("````") ? "````" : "```";
  const content = `${fence}\n- [ ] Example task\n${marker}\n- [ ] Actual task`;
  expect(parseNeeded(content, repo, null).map(item => item.text)).toEqual(["Actual task"]);
});
it("ignores fenced examples indented inside list content", () => {
  expect(parseNeeded("- [ ] Actual task\n    ```md\n    - [ ] Example task\n    ```", repo, null).map(item => item.text)).toEqual(["Actual task"]);
});
it("keeps a shorter nested fence inside a larger code example", () => {
  const content = "````markdown\n```\n- [ ] Still an example\n```\n````\n- [ ] Actual task";
  expect(parseNeeded(content, repo, null).map(item => item.text)).toEqual(["Actual task"]);
});
it("does not turn explanatory bullets into tasks after all checkboxes are finished", () => {
  expect(neededTodoItems("- [x] Completed work\n- Explanatory note", repo, null)).toEqual([]);
});
it("ignores example checkboxes when choosing the actual list format", () => {
  expect(neededTodoItems("```\n- [ ] Example\n```\n- Actual task", repo, null).map(item => item.text)).toEqual(["Actual task"]);
});
it("removes the actual source line rather than an identical earlier example", () => {
  const content = "```\n- [ ] Repeated text\n```\n- [ ] Repeated text";
  expect(removeNeededLine(content, "- [ ] Repeated text")).toEqual({ next: "```\n- [ ] Repeated text\n```\n", removed: true });
  expect(removeNeededLine("```\n- [ ] Repeated text\n```", "- [ ] Repeated text").removed).toBe(false);
});
it("removes captured duplicates once each while preserving mixed newlines and fenced examples", () => {
  const content = "# Tasks\r\n```\n- [ ] Repeat\r\n```\r\n- [ ] Repeat\n- [ ] Keep\r\n- [ ] Repeat\r\n- [ ] Repeat";
  expect(removeNeededLines(content, ["- [ ] Repeat", "- [ ] Repeat"])).toEqual({
    next: "# Tasks\r\n```\n- [ ] Repeat\r\n```\r\n- [ ] Keep\r\n- [ ] Repeat", removed: 2,
  });
});
it("leaves untouched end-of-file bytes unchanged", () => {
  expect(removeNeededLines("- [ ] Remove\r\nEnd", ["- [ ] Remove"])).toEqual({ next: "End", removed: 1 });
  expect(removeNeededLines("End\r\n- [ ] Remove", ["- [ ] Remove"])).toEqual({ next: "End\r\n", removed: 1 });
  expect(removeNeededLines("End\r\n", ["not present", ""])).toEqual({ next: "End\r\n", removed: 0 });
});
it("does not adopt example metadata and retains explicitly captured continuation owners", () => {
  const content = "- [ ] Actual task\n  ```\n  [owner:ai]\n  ```";
  expect(parseNeeded(content, repo, null)[0].assignee).toBeNull();
  expect(assigneeForTodo("- [ ] Continuation owner", "ai")).toBe("ai"); expect(assigneeForTodo("- [ ] Legacy [owner:me]")).toBe("me");
});
