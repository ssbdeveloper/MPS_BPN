"use strict";

// Single source of truth for the application timezone.
//
// The timezone is configured ONCE, in the root .env as TIMEZONE (currently Asia/Makassar).
// Nothing in this codebase may hardcode a timezone literal: several dashboard queries bucket
// rows by day and compare against CURRENT_DATE, which follows the Postgres session timezone.
// A literal that disagrees with the session timezone silently shifts rows into the wrong
// calendar day (that was a real bug: 'Asia/Jakarta' literals vs an Asia/Makassar session).
//
// The value is validated as an IANA-style zone name so it is safe to interpolate directly
// into SQL template literals (it never reaches SQL unvalidated).

const DEFAULT_TIMEZONE = "Asia/Makassar";
const IANA_ZONE = /^[A-Za-z][A-Za-z_+-]*(?:\/[A-Za-z][A-Za-z0-9_+-]*)+$/;

function resolveTimezone() {
  const raw = String(process.env.TIMEZONE || "").trim();
  return IANA_ZONE.test(raw) ? raw : DEFAULT_TIMEZONE;
}

module.exports = { resolveTimezone, DEFAULT_TIMEZONE };
