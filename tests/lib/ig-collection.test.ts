import { describe, expect, it } from "vitest";
import { chunkRows, collectionShortcode, filterCollection, mergeSavedExports, parseSavedExport, shortcodesFromText, type CollectionPost } from "@/lib/marketing/ig-collection";

const savedMedia = { saved_saved_media: [
  { title: "creator_one", string_map_data: { "Saved on": { href: "https://www.instagram.com/p/AAA111/", timestamp: 1762000000 } } },
  { title: "creator_two", string_map_data: { "Saved on": { href: "https://www.instagram.com/reel/BBB222/?igsh=abc", timestamp: 1762600000 } } },
  { title: "creator_one", string_map_data: { "Saved on": { href: "https://www.instagram.com/p/AAA111/", timestamp: 1762000000 } } },
  { title: "someone", string_map_data: { "Saved on": { href: "https://www.instagram.com/someone/saved/all-posts/", timestamp: 1762000000 } } },
] };
const savedCollections = { saved_saved_collections: [
  { title: "Collection", string_map_data: { Name: { value: "Tipy" }, "Creation Time": { timestamp: 1761000000 } } },
  { string_map_data: { Name: { href: "https://www.instagram.com/reel/BBB222/", value: "creator_two" }, "Added Time": { timestamp: 1762600500 } } },
  { title: "Collection", string_map_data: { Name: { value: "Reels" } } },
  { string_map_data: { Name: { href: "https://www.instagram.com/p/CCC333/", value: "creator_three" }, "Added Time": { timestamp: 1762700000 } } },
] };

describe("IG Kolekce export parsing", () => {
  it("reads the saved posts file and deduplicates by shortcode", () => {
    const parsed = parseSavedExport(savedMedia);
    expect(parsed.kind).toBe("saved-media");
    expect(parsed.rows.map((r) => r.shortcode)).toEqual(["AAA111", "BBB222"]);
    expect(parsed.rows[0]).toMatchObject({ author: "creator_one", saved_at: new Date(1762000000 * 1000).toISOString() });
    expect(parsed.rejected).toBe(1); // the private Saved collection URL
  });

  it("reads collection names and merges both files", () => {
    const collections = parseSavedExport(savedCollections);
    expect(collections.rows).toEqual([
      expect.objectContaining({ shortcode: "BBB222", author: "creator_two", collections: ["Tipy"] }),
      expect.objectContaining({ shortcode: "CCC333", author: "creator_three", collections: ["Reels"] }),
    ]);
    const merged = mergeSavedExports([parseSavedExport(savedMedia), collections]);
    expect(merged.map((r) => r.shortcode)).toEqual(["CCC333", "BBB222", "AAA111"]);
    expect(merged.find((r) => r.shortcode === "BBB222")).toMatchObject({ collections: ["Tipy"], saved_at: new Date(1762600000 * 1000).toISOString() });
  });

  it("reads the label_values form and rejects unrelated files", () => {
    const parsed = parseSavedExport({ saved_saved_media: [{ label_values: [{ label: "URL", value: "https://www.instagram.com/p/DDD444/" }, { label: "Saved on", timestamp_value: 1762800000 }] }] });
    expect(parsed.rows[0]).toMatchObject({ shortcode: "DDD444", saved_at: new Date(1762800000 * 1000).toISOString() });
    expect(() => parseSavedExport({ followers: [] })).toThrow("collection-export-unsupported");
  });

  it("accepts post and Reel URLs only", () => {
    expect(collectionShortcode("https://instagram.com/reel/ABC_1-2/")).toBe("ABC_1-2");
    expect(collectionShortcode("https://www.instagram.com/creator/p/ABC/")).toBe("ABC");
    expect(collectionShortcode("https://www.instagram.com/creator/saved/ideas/1789/")).toBeNull();
    expect(collectionShortcode("http://instagram.com/p/ABC/")).toBeNull();
    expect(collectionShortcode("https://evil.example/p/ABC/")).toBeNull();
    expect(shortcodesFromText("one https://www.instagram.com/p/AAA/ two https://www.instagram.com/reel/AAA/?igsh=1\nhttps://example.com/x")).toEqual({ shortcodes: ["AAA"], rejected: 1 });
  });

  it("chunks imports at 500 rows", () => {
    expect(chunkRows(Array.from({ length: 1201 }, (_, i) => i)).map((c) => c.length)).toEqual([500, 500, 201]);
  });

  it("filters by status, project, tag and search", () => {
    const post = (id: string, patch: Partial<CollectionPost>): CollectionPost => ({ id, shortcode: id, url: "", author: null, saved_at: null, published_at: null, collections: [], status: "queued", error: null, thumbnail: null, media_type: null, digest: null, processed_at: null, ...patch });
    const posts = [post("A", { status: "done", author: "Hookmaster", digest: { summary: "Háčky v první vteřině.", tips: [], tags: ["hooks"], project: "devShark" } }), post("B", { collections: ["Tipy"] })];
    expect(filterCollection(posts, { status: "done", project: "all", tag: "all", search: "" }).map((p) => p.id)).toEqual(["A"]);
    expect(filterCollection(posts, { status: "all", project: "devShark", tag: "all", search: "hacky" }).map((p) => p.id)).toEqual(["A"]);
    expect(filterCollection(posts, { status: "all", project: "all", tag: "Tipy", search: "" }).map((p) => p.id)).toEqual(["B"]);
  });
});
