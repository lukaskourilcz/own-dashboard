import { expect, it } from "vitest";
import { parseNeeded, neededTodoItems, removeNeededLine, assigneeForTodo } from "@/lib/needed";
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
  expect(removeNeededLine(content, "- [ ] Repeated text")).toEqual({ next: "```\n- [ ] Repeated text\n```", removed: true });
  expect(removeNeededLine("```\n- [ ] Repeated text\n```", "- [ ] Repeated text").removed).toBe(false);
});
it("does not adopt example metadata and retains explicitly captured continuation owners", () => {
  const content = "- [ ] Actual task\n  ```\n  [owner:ai]\n  ```";
  expect(parseNeeded(content, repo, null)[0].assignee).toBeNull();
  expect(assigneeForTodo("- [ ] Continuation owner", "ai")).toBe("ai"); expect(assigneeForTodo("- [ ] Legacy [owner:me]")).toBe("me");
});
