import { test, expect } from "@playwright/test";
import { DEFAULT_LAYOUT } from "../src/lib/dashboard-layout";
import { gotoPreview, watchConsole } from "./helpers";

// Derived from the app's own default layout so adding a widget (e.g. the
// recurring-plans card) can never silently break this spec again.
const DEFAULT_WIDGET_COUNT = DEFAULT_LAYOUT.length;

test.describe("customizable overview", () => {
  test("reorder controls, remove, add dialog, persistence, and reset", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    // The reset action confirms via window.confirm — always accept.
    page.on("dialog", (d) => d.accept());

    await gotoPreview(page);

    const customize = page.getByRole("button", { name: "Customize" });
    await customize.click();

    const removeButtons = page.getByRole("button", { name: "Remove widget" });
    const dragHandles = page.getByRole("button", { name: "Drag to reorder" });
    await expect(removeButtons).toHaveCount(DEFAULT_WIDGET_COUNT);
    await expect(dragHandles).toHaveCount(DEFAULT_WIDGET_COUNT);

    // Remove one widget.
    await removeButtons.first().click();
    await expect(removeButtons).toHaveCount(DEFAULT_WIDGET_COUNT - 1);

    // Layout persists across reloads (localStorage).
    await page.reload();
    await page.getByRole("button", { name: "Customize" }).click();
    await expect(page.getByRole("button", { name: "Remove widget" })).toHaveCount(
      DEFAULT_WIDGET_COUNT - 1,
    );

    // Add it back via the dialog.
    await page.getByRole("button", { name: "Add widget" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveClass(/anim-dialog/); // entrance animation wired
    await expect(dialog.getByText("Add a widget")).toBeVisible();

    // Each available widget is an option button in the list.
    const option = dialog.locator("ul li button").first();
    await expect(option).toBeVisible();
    await option.click();
    // Close the dialog.
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Remove widget" })).toHaveCount(
      DEFAULT_WIDGET_COUNT,
    );

    // Remove two, then Reset restores the full default layout.
    await page.getByRole("button", { name: "Remove widget" }).first().click();
    await page.getByRole("button", { name: "Remove widget" }).first().click();
    await expect(page.getByRole("button", { name: "Remove widget" })).toHaveCount(
      DEFAULT_WIDGET_COUNT - 2,
    );
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByRole("button", { name: "Remove widget" })).toHaveCount(
      DEFAULT_WIDGET_COUNT,
    );

    // Exit edit mode — controls disappear. ("exact" avoids matching the
    // streak panel's "Done today" buttons.)
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "Remove widget" })).toHaveCount(
      0,
    );

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
