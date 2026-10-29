import { dneskaiSourceById } from "./dneskai-registry";
import { dneskaiPublisherName } from "./dneskai-media-plan";
import { dneskaiFallbackPublisher, type DneskaiEvidencePublishers } from "./dneskai-generation";

/**
 * Publisher labels for the model's internal evidence offer: registry names or
 * Instagram accounts help attribute claims to their actors. They never create
 * source lines or picture credits in a post. Kept apart so offline generation
 * bundles do not pull in the registry and its path aliases.
 */
export const dneskaiEvidencePublishers: DneskaiEvidencePublishers = async (evidence) => evidence.map((item) => {
  const source = dneskaiSourceById(item.sourceId);
  if (!source) return dneskaiFallbackPublisher(item);
  if (source.kind === "instagram") {
    const profile = new URL(source.url).pathname.split("/").filter(Boolean)[0];
    return profile ? `@${profile} (Instagram)` : dneskaiFallbackPublisher(item);
  }
  return dneskaiPublisherName(source);
});
