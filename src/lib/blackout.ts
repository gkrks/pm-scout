/**
 * Blackout window guard.
 *
 * The scanner is silent during 5 PM → 4:59 AM in BLACKOUT_TIMEZONE (default:
 * America/Los_Angeles). This is enforced at runtime rather than via the cron
 * expression because GitHub Actions cron is UTC-only and cannot express a
 * local-time window that survives Daylight Saving Time.
 *
 * Environment variables:
 *   BLACKOUT_TIMEZONE   — IANA zone name (default: America/Los_Angeles)
 *   BLACKOUT_START_HOUR — 24-hour local hour to start blackout (default: 17 = 5 PM)
 *   BLACKOUT_END_HOUR   — 24-hour local hour to end blackout (default: 5 = 5 AM, exclusive)
 */

/** Returns true when the current moment falls inside the blackout window. */
export function isInBlackout(now: Date = new Date()): boolean {
  const tz        = process.env.BLACKOUT_TIMEZONE   || "America/Los_Angeles";
  const startHour = parseInt(process.env.BLACKOUT_START_HOUR ?? "17", 10); // 5 PM
  const endHour   = parseInt(process.env.BLACKOUT_END_HOUR   ?? "5",  10); // 5 AM (exclusive)

  const hourLocal = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(now),
    10,
  );

  // Window crosses midnight (e.g. start=17, end=5 → 17,18,...,23,0,1,2,3,4)
  if (startHour > endHour) {
    return hourLocal >= startHour || hourLocal < endHour;
  }
  // Window doesn't cross midnight (e.g. start=2, end=5 → 2,3,4)
  return hourLocal >= startHour && hourLocal < endHour;
}

/** Human-readable string describing the current time vs. blackout window. */
export function describeBlackoutState(now: Date = new Date()): string {
  const tz        = process.env.BLACKOUT_TIMEZONE   || "America/Los_Angeles";
  const startHour = parseInt(process.env.BLACKOUT_START_HOUR ?? "17", 10);
  const endHour   = parseInt(process.env.BLACKOUT_END_HOUR   ?? "5",  10);

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour:     "numeric",
    minute:   "2-digit",
    hour12:   true,
    timeZoneName: "short",
  });

  const padH = (h: number) => String(h).padStart(2, "0");
  return (
    `Now: ${fmt.format(now)}  ·  ` +
    `Blackout: ${padH(startHour)}:00–${padH(endHour)}:00 ${tz}`
  );
}
