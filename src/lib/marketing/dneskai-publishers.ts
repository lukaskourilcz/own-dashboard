import { DNESKAI_SOURCES } from "./dneskai-registry";
import { dneskaiPublisherName } from "./dneskai-media-plan";
import { dneskaiFallbackPublisher, type DneskaiEvidencePublishers } from "./dneskai-generation";

/**
 * The publisher each source line of a DNESKAi post names (#116): the registry's publisher name, as the picture
 * credits use it (#114), or the Instagram account. Kept apart from generation so that the offline scripts that
 * bundle the generation module do not pull in the registry and its path aliases.
 */
export const dneskaiEvidencePublishers: DneskaiEvidencePublishers = async (evidence) => evidence.map((item) => {
  const source = DNESKAI_SOURCES.find((entry) => entry.id === item.sourceId);
  if (!source) return dneskaiFallbackPublisher(item);
  if (source.kind === "instagram") {
    const profile = new URL(source.url).pathname.split("/").filter(Boolean)[0];
    return profile ? `@${profile} (Instagram)` : dneskaiFallbackPublisher(item);
  }
  return dneskaiPublisherName(source);
});
