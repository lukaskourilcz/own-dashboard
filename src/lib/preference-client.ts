"use client";

let saveQueue: Promise<void> = Promise.resolve();

/**
 * Serialize preference writes so rapid toggles cannot arrive out of order.
 * The API performs an own-row upsert; callers decide how to present failures.
 */
export function saveUserPreferences(
  patch: Record<string, unknown>,
): Promise<void> {
  const run = async () => {
    const response = await fetch("/api/user/preferences", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      throw new Error("Could not save preferences.");
    }
  };
  saveQueue = saveQueue.catch(() => undefined).then(run);
  return saveQueue;
}
