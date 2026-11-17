// Theme core: light / dark / auto, where "auto" follows the sun at the
// user's location. We never ask for geolocation — instead we map the
// browser's IANA timezone (Intl) to approximate coordinates and run a
// standard sunrise/sunset calculation. That's the same trick the Claude
// apps use: it's not magic, it just knows your timezone.

export type ThemeMode = "light" | "dark" | "auto";

export const THEME_KEY = "theme"; // stores the ThemeMode
export const RESOLVED_KEY = "theme-dark"; // "1" | "0", cached for no-flash paint

export function isThemeMode(v: unknown): v is ThemeMode {
  return v === "light" || v === "dark" || v === "auto";
}

export function readMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return isThemeMode(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

// ---------------------------------------------------------------------------
// Sunrise / sunset (NOAA algorithm, adapted from SunCalc — public domain).
// Returns UTC Date objects, or null at the poles when the sun never crosses
// the horizon on the given day (polar day / night).
// ---------------------------------------------------------------------------

const rad = Math.PI / 180;
const dayMs = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397; // obliquity of the ecliptic
const J0 = 0.0009;
const H0 = -0.833 * rad; // sun's angular radius + atmospheric refraction

const toJulian = (d: Date) => d.valueOf() / dayMs - 0.5 + J1970;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * dayMs);
const toDays = (d: Date) => toJulian(d) - J2000;

function solarMeanAnomaly(d: number) {
  return rad * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M: number) {
  const C =
    rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = rad * 102.9372; // perihelion of the Earth
  return M + C + P + Math.PI;
}

function declination(l: number) {
  return Math.asin(Math.sin(l) * Math.sin(e));
}

function solarTransitJ(ds: number, M: number, L: number) {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
}

function hourAngle(h: number, phi: number, dec: number) {
  return Math.acos(
    (Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)),
  );
}

export function sunTimes(
  date: Date,
  lat: number,
  lng: number,
): { sunrise: Date; sunset: Date } | null {
  const lw = rad * -lng;
  const phi = rad * lat;
  const d = toDays(date);

  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + (0 + lw) / (2 * Math.PI) + n;
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const Jnoon = solarTransitJ(ds, M, L);

  const w0 = hourAngle(H0, phi, dec);
  if (Number.isNaN(w0)) return null; // polar day or night

  const Jset = solarTransitJ(J0 + (w0 + lw) / (2 * Math.PI) + n, M, L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
}

// ---------------------------------------------------------------------------
// Where are we? Resolve coordinates from the IANA timezone, with a longitude
// estimate from the UTC offset as a last resort.
// ---------------------------------------------------------------------------

export function currentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

export function coordsForTimezone(tz: string): { lat: number; lng: number } {
  const hit = TZ_COORDS[tz];
  if (hit) return { lat: hit[0], lng: hit[1] };

  // Fallback: derive longitude from the current UTC offset (15° per hour),
  // and assume a temperate latitude. getTimezoneOffset() is minutes that you
  // add to local time to reach UTC, so it's negative east of Greenwich.
  let lng = 0;
  try {
    lng = -new Date().getTimezoneOffset() / 4;
  } catch {
    lng = 0;
  }
  return { lat: 40, lng };
}

// ---------------------------------------------------------------------------
// Resolve a mode to a concrete dark boolean, and figure out when "auto" should
// next flip so callers can schedule a single precise timer instead of polling.
// ---------------------------------------------------------------------------

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function resolveDark(mode: ThemeMode, now: Date = new Date()): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;

  const { lat, lng } = coordsForTimezone(currentTimezone());
  const today = sunTimes(now, lat, lng);
  if (!today) {
    // Polar day/night — fall back to the OS preference rather than guess.
    return prefersDark();
  }
  return now < today.sunrise || now >= today.sunset;
}

// The next moment "auto" changes value, so we can set one timer. Returns null
// for fixed modes (no scheduling needed) or when the sun calc is unavailable.
export function nextAutoFlip(now: Date = new Date()): Date | null {
  const { lat, lng } = coordsForTimezone(currentTimezone());
  const today = sunTimes(now, lat, lng);
  if (!today) return null;

  if (now < today.sunrise) return today.sunrise;
  if (now < today.sunset) return today.sunset;

  const tomorrow = sunTimes(new Date(now.getTime() + dayMs), lat, lng);
  return tomorrow ? tomorrow.sunrise : null;
}

export function applyDark(dark: boolean) {
  try {
    document.documentElement.classList.toggle("dark", dark);
  } catch {}
}

export function persistMode(mode: ThemeMode, dark: boolean) {
  try {
    localStorage.setItem(THEME_KEY, mode);
    localStorage.setItem(RESOLVED_KEY, dark ? "1" : "0");
  } catch {}
}

// ---------------------------------------------------------------------------
// IANA timezone -> [latitude, longitude]. Representative coordinates for each
// zone (≈ the zone.tab anchor city). Not exhaustive; unknown zones fall back
// to the UTC-offset estimate above. Ireland and Turkey — this app's two
// countries — are exact.
// ---------------------------------------------------------------------------

const TZ_COORDS: Record<string, [number, number]> = {
  "Europe/Dublin": [53.33, -6.25],
  "Europe/Istanbul": [41.01, 28.96],
  "Europe/London": [51.51, -0.13],
  "Europe/Lisbon": [38.72, -9.14],
  "Europe/Madrid": [40.42, -3.7],
  "Europe/Paris": [48.85, 2.35],
  "Europe/Brussels": [50.85, 4.35],
  "Europe/Amsterdam": [52.37, 4.9],
  "Europe/Berlin": [52.52, 13.41],
  "Europe/Zurich": [47.38, 8.54],
  "Europe/Rome": [41.9, 12.5],
  "Europe/Vienna": [48.21, 16.37],
  "Europe/Prague": [50.08, 14.44],
  "Europe/Warsaw": [52.23, 21.01],
  "Europe/Copenhagen": [55.68, 12.57],
  "Europe/Oslo": [59.91, 10.75],
  "Europe/Stockholm": [59.33, 18.07],
  "Europe/Helsinki": [60.17, 24.94],
  "Europe/Athens": [37.98, 23.73],
  "Europe/Bucharest": [44.43, 26.1],
  "Europe/Budapest": [47.5, 19.04],
  "Europe/Kyiv": [50.45, 30.52],
  "Europe/Kiev": [50.45, 30.52],
  "Europe/Moscow": [55.76, 37.62],
  "Atlantic/Reykjavik": [64.15, -21.94],
  "America/New_York": [40.71, -74.01],
  "America/Toronto": [43.65, -79.38],
  "America/Chicago": [41.88, -87.63],
  "America/Denver": [39.74, -104.99],
  "America/Phoenix": [33.45, -112.07],
  "America/Los_Angeles": [34.05, -118.24],
  "America/Vancouver": [49.28, -123.12],
  "America/Anchorage": [61.22, -149.9],
  "Pacific/Honolulu": [21.31, -157.86],
  "America/Mexico_City": [19.43, -99.13],
  "America/Bogota": [4.71, -74.07],
  "America/Lima": [-12.05, -77.04],
  "America/Sao_Paulo": [-23.55, -46.63],
  "America/Argentina/Buenos_Aires": [-34.61, -58.38],
  "America/Santiago": [-33.45, -70.67],
  "Africa/Casablanca": [33.57, -7.59],
  "Africa/Lagos": [6.52, 3.38],
  "Africa/Cairo": [30.04, 31.24],
  "Africa/Johannesburg": [-26.2, 28.05],
  "Africa/Nairobi": [-1.29, 36.82],
  "Asia/Jerusalem": [31.78, 35.22],
  "Asia/Dubai": [25.2, 55.27],
  "Asia/Tehran": [35.69, 51.39],
  "Asia/Karachi": [24.86, 67.0],
  "Asia/Kolkata": [22.57, 88.36],
  "Asia/Calcutta": [22.57, 88.36],
  "Asia/Dhaka": [23.81, 90.41],
  "Asia/Bangkok": [13.76, 100.5],
  "Asia/Jakarta": [-6.21, 106.85],
  "Asia/Singapore": [1.35, 103.82],
  "Asia/Hong_Kong": [22.32, 114.17],
  "Asia/Shanghai": [31.23, 121.47],
  "Asia/Taipei": [25.03, 121.57],
  "Asia/Seoul": [37.57, 126.98],
  "Asia/Tokyo": [35.68, 139.69],
  "Australia/Perth": [-31.95, 115.86],
  "Australia/Adelaide": [-34.93, 138.6],
  "Australia/Sydney": [-33.87, 151.21],
  "Australia/Melbourne": [-37.81, 144.96],
  "Australia/Brisbane": [-27.47, 153.03],
  "Pacific/Auckland": [-36.85, 174.76],
};
