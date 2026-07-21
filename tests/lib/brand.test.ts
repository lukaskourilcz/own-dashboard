import { describe, expect, it } from "vitest";
import { brandConfig } from "@/lib/brand";

describe("brandConfig", () => {
  it("derives rename-sensitive values from the product name", () => {
    const expectedPrefix = brandConfig.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    expect(brandConfig.titleTemplate).toBe(`%s · ${brandConfig.name}`);
    expect(brandConfig.fileNamePrefix).toBe(expectedPrefix);
  });
});
