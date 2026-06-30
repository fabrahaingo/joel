// In-memory registry mapping a sent Signal poll (keyed by its send timestamp)
// to the ordered list of option labels it was built from.
//
// Signal poll votes arrive as numeric option indexes
// (envelope.dataMessage.pollVote.optionIndexes), unlike Matrix poll responses
// which carry the answer text directly. We therefore remember the options we
// sent so an incoming vote can be resolved back to its menu label.
//
// The Signal bot is a single process, so a module-level Map is sufficient.
// Menus are ephemeral: entries expire after a TTL and the map is size-capped.

const POLL_REGISTRY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const POLL_REGISTRY_MAX_ENTRIES = 500;

interface PollMenuEntry {
  options: string[];
  expiresAt: number;
}

const pollRegistry = new Map<number, PollMenuEntry>();

function evictExpired(now: number): void {
  for (const [timestamp, entry] of pollRegistry) {
    if (entry.expiresAt <= now) pollRegistry.delete(timestamp);
  }
}

/** Remember the ordered options of a poll menu we just sent. */
export function registerPollMenu(
  pollTimestamp: number,
  options: string[]
): void {
  const now = Date.now();
  evictExpired(now);

  // Size cap: drop oldest insertion(s). Map preserves insertion order, so the
  // first key iterated is the oldest.
  while (pollRegistry.size >= POLL_REGISTRY_MAX_ENTRIES) {
    for (const oldest of pollRegistry.keys()) {
      pollRegistry.delete(oldest);
      break;
    }
  }

  pollRegistry.set(pollTimestamp, {
    options: [...options],
    expiresAt: now + POLL_REGISTRY_TTL_MS
  });
}

/**
 * Resolve an incoming poll vote to the selected option label.
 * Returns undefined if the poll is unknown/expired or the index is out of range.
 */
export function resolvePollVote(
  targetSentTimestamp: number,
  optionIndexes: number[]
): string | undefined {
  evictExpired(Date.now());

  const entry = pollRegistry.get(targetSentTimestamp);
  if (entry === undefined) return undefined;

  // optionIndexes[0] may be absent (empty vote) and the index may be out of
  // range; both yield undefined here, which is the intended "no match" result.
  return entry.options[optionIndexes[0]];
}

/** Test helper: clear all registered polls. */
export function clearPollRegistry(): void {
  pollRegistry.clear();
}
