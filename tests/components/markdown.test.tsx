import { renderToStaticMarkup } from "react-dom/server";
import { load } from "cheerio";
import { expect, it } from "vitest";
import { Markdown } from "@/components/ui/markdown";
const render = (source: string, headingStart?: 2 | 3) => renderToStaticMarkup(<Markdown source={source} tableLabel="Document table" codeLabel="Code block" headingStart={headingStart} />);
it("exposes real nested document headings without adding another page h1", () => {
  const $ = load(render("# Title\n\n## Section\n\n### Detail\n\n###### Last"));
  expect($("h1")).toHaveLength(0); expect($("h2").text()).toBe("Title"); expect($("h3").text()).toBe("Section"); expect($("h4").text()).toBe("Detail"); expect($("h6").text()).toBe("Last");
  expect(load(render("# Title\n\n## Section",3))("h3").text()).toBe("Title");
});
it("preserves inline formatting and escapes authored HTML and code", () => {
  const $ = load(render("**Bold** and `inline`\n\n<script>alert(1)</script>\n\n```html\n<script>code</script>\n```"));
  expect($("strong").text()).toBe("Bold"); expect($("p code").text()).toBe("inline"); expect($("script")).toHaveLength(0); expect($("pre code").text()).toBe("<script>code</script>"); expect($("p").text()).toContain("<script>alert(1)</script>");
});
it("only links canonical bounded HTTP(S) URLs without credentials or control characters", () => {
  const source = ["[Good](https://example.com)", "[Local](http://localhost:3000/a)", "[Credential](https://user:pass@example.com/)", "[Script](javascript:alert)", "[Relative](/private)", "[Control](https://exam\u0001ple.com/)", `[Long](https://example.com/${"x".repeat(2000)})`].join(" ");
  const $ = load(render(source)); expect($("a").map((_, a) => $(a).attr("href")).get()).toEqual(["https://example.com/", "http://localhost:3000/a"]);
  expect($("a").map((_, a) => $(a).text()).get()).toEqual(["Good", "Local"]); expect($("body").text()).toContain("Credential"); expect($("a").first().attr("rel")).toBe("noreferrer");
});
it("preserves long malformed bracket and link runs without quadratic rescanning", () => {
  for (const source of ["[".repeat(250000), "[a](".repeat(50000), `${"[".repeat(100000)}[valid](https://example.com/)`]) {
    const html = render(source), $ = load(html); expect($("body").text()).toBe(source.endsWith("example.com/)") ? `${"[".repeat(100000)}valid` : source);
  }
});
it("makes document tables and code blocks named keyboard scrolling regions", () => {
  const $ = load(render("| Name | Amount |\n| :--- | ---: |\n| Fixture | 10 |\n\n```\nwide code\n```"));
  expect($('[role="region"][aria-label="Document table"]').attr("tabindex")).toBe("0"); expect($("table caption").text()).toBe("Document table"); expect($("th[scope=col]")).toHaveLength(2);
  expect($("td").last().attr("class")).toContain("text-right"); expect($('pre[role="region"][aria-label="Code block"]').attr("tabindex")).toBe("0");
});
it("retains ordered/unordered lists, blank cells, CRLF and unclosed code fences", () => {
  const $ = load(render("- First\r\n- Second\r\n\r\n1. One\r\n2. Two\r\n\r\n| A | B |\r\n| --- | --- |\r\n| Only |\r\n\r\n```\r\nunclosed"));
  expect($("ul li")).toHaveLength(2); expect($("ol li")).toHaveLength(2); expect($("td").last().text()).toBe(""); expect($("pre code").text()).toBe("unclosed");
});
