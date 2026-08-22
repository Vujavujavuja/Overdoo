/**
 * AviationStack emits airport-LOCAL wall-clock time with a hardcoded "+00:00"
 * offset. Taken at face value every timestamp is wrong by the airport's UTC
 * offset — two hours for Frankfurt in summer — which silently corrupts delay
 * minutes and therefore payouts. It does supply the IANA zone, so we reinterpret
 * the wall-clock reading in that zone.
 */

/** How far `timeZone` is ahead of UTC at the given instant, in ms. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(instant).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/** Strip any trailing offset/Z, leaving the naive wall-clock portion. */
function stripOffset(value: string): string {
  return value.replace(/(Z|[+-]\d{2}:?\d{2})$/, '');
}

/**
 * Interpret an AviationStack timestamp as wall-clock time in `timeZone` and
 * return the true UTC instant. Falls back to plain parsing if the zone is
 * missing or unknown, since a slightly wrong time still beats no data — the
 * consensus check downstream will reject it if the providers then disagree.
 */
export function aviationStackTimeToUtc(
  value: string | null | undefined,
  timeZone: string | null | undefined,
): Date | null {
  if (!value) return null;

  const naive = stripOffset(value);
  const pretendUtc = new Date(`${naive}Z`);
  if (Number.isNaN(pretendUtc.getTime())) return null;
  if (!timeZone) return pretendUtc;

  try {
    const offset = zoneOffsetMs(pretendUtc, timeZone);
    return new Date(pretendUtc.getTime() - offset);
  } catch {
    return pretendUtc;
  }
}
