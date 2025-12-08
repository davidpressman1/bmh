// Exact coordinates for BMH – Mt Ivy, NY
const LAT = 41.19392515448243;
const LNG = -74.02504208449552;
const ZENITH_DEG = 90.0;

// Calibration: this Motzaei Shabbos Maariv was at 5:17 PM,
// defined as 50 minutes after shkiya.
const CALIBRATION_ENABLED = true;
const REFERENCE_SHABBOS = "2025-12-06";
const REFERENCE_MOTZAEI_MAARIV = "17:17";
const REFERENCE_MAARIV_OFFSET_MIN = 50;

let CAL_OFFSET_MS = 0;

function toDateParts(date) {
  const d = new Date(date);
  return {
    year: d.getFullYear(),
    month: d.getMonth(),
    day: d.getDate()
  };
}

function dayOfYear(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

// NOAA solar calculator algorithm – sunset (UT hours) with configurable zenith
function noaaSunsetUT(date, latDeg, lngDeg, zenithDeg) {
  const N = dayOfYear(date);
  const lngHour = lngDeg / 15.0;

  // Approximate time for sunset
  const t = N + ((18 - lngHour) / 24.0);

  const M = (0.9856 * t) - 3.289;

  const sin = x => Math.sin(x * Math.PI / 180);
  const cos = x => Math.cos(x * Math.PI / 180);
  const tan = x => Math.tan(x * Math.PI / 180);

  let L = M + (1.916 * sin(M)) + (0.020 * sin(2 * M)) + 282.634;
  L = ((L % 360) + 360) % 360;

  let RA = Math.atan(0.91764 * tan(L)) * 180 / Math.PI;
  RA = ((RA % 360) + 360) % 360;

  const Lquadrant = Math.floor(L / 90) * 90;
  const RAquadrant = Math.floor(RA / 90) * 90;
  RA = RA + (Lquadrant - RAquadrant);
  RA /= 15.0;

  const sinDec = 0.39782 * sin(L);
  const cosDec = Math.cos(Math.asin(sinDec));

  const cosH = (cos(zenithDeg) - (sinDec * sin(LAT))) / (cosDec * cos(LAT));

  if (cosH < -1 || cosH > 1) {
    return null;
  }

  let H = Math.acos(cosH) * 180 / Math.PI;
  H = H / 15.0;

  const T = H + RA - (0.06571 * t) - 6.622;

  let UT = T - lngHour;
  UT = ((UT % 24) + 24) % 24;
  return UT;
}

function getNoaaSunsetDateRaw(date, latDeg, lngDeg, zenithDeg) {
  const { year, month, day } = toDateParts(date);
  const utHours = noaaSunsetUT(new Date(year, month, day), latDeg, lngDeg, zenithDeg);
  if (utHours == null) return null;

  const hours = Math.floor(utHours);
  const minutes = Math.round((utHours - hours) * 60);

  const baseUTC = Date.UTC(year, month, day, 0, 0, 0);
  const sunsetUTC = new Date(baseUTC + (hours * 60 + minutes) * 60 * 1000);
  return sunsetUTC;
}

function getSunsetWithCalibration(date) {
  const raw = getNoaaSunsetDateRaw(date, LAT, LNG, ZENITH_DEG);
  if (!raw) return null;
  if (!CALIBRATION_ENABLED || !CAL_OFFSET_MS) return raw;
  return new Date(raw.getTime() + CAL_OFFSET_MS);
}

function formatTimeLocal(date) {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

// NEW: get Sunday of the current week (week starts Sunday)
function getSundayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 = Sun, ... 6 = Sat
  d.setDate(d.getDate() - day); // back to Sunday
  d.setHours(12, 0, 0, 0);
  return d;
}

function getComingShabbos(fromDate) {
  const d = new Date(fromDate);
  let day = d.getDay();
  let diff = (6 - day + 7) % 7;
  if (diff === 0 && d.getHours() >= 18) {
    diff = 7;
  }
  d.setDate(d.getDate() + diff);
  d.setHours(12, 0, 0, 0);
  return d;
}

function parseLocalTimeOnDate(dateString, timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  const d = new Date(dateString + "T00:00:00");
  d.setHours(h, m, 0, 0);
  return d;
}

function computeCalibrationOffsetMs() {
  if (!CALIBRATION_ENABLED) return 0;

  const shabbosDate = new Date(REFERENCE_SHABBOS + "T12:00:00");
  const computedSunset = getNoaaSunsetDateRaw(shabbosDate, LAT, LNG, ZENITH_DEG);
  if (!computedSunset) return 0;

  const maarivActual = parseLocalTimeOnDate(REFERENCE_SHABBOS, REFERENCE_MOTZAEI_MAARIV);
  const shkiyahActual = new Date(maarivActual.getTime() - REFERENCE_MAARIV_OFFSET_MIN * 60 * 1000);

  const offsetMs = shkiyahActual.getTime() - computedSunset.getTime();
  return offsetMs;
}

async function updateWeekdayMinchaMaariv() {
  const today = new Date();
  const sunday = getSundayOfWeek(today);
  const sunsets = [];

  // Sun–Thu sunset (with calibration)
  for (let i = 0; i < 5; i++) {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i); // Sunday + 0..4 => Sun..Thu
    const sunset = getSunsetWithCalibration(d);
    if (sunset) sunsets.push(sunset);
  }

  try {
    if (!sunsets.length) throw new Error("No sunsets computed");

    // earliest Sun–Thu sunset
    let earliest = sunsets[0];
    for (const s of sunsets) {
      if (s.getTime() < earliest.getTime()) earliest = s;
    }

    // Mincha/Maariv = 15 minutes before shkiya
    const minchaTime = new Date(earliest.getTime() - 15 * 60 * 1000);
    const timeStr = formatTimeLocal(minchaTime);

    const elMain = document.getElementById("weekdayMinchaMaariv");
    const elCard = document.getElementById("weekdayMinchaMaarivCard");
    const elHero = document.getElementById("heroWeekdayMincha");

    if (elMain) elMain.textContent = timeStr;
    if (elCard) elCard.textContent = timeStr;
    if (elHero) elHero.textContent = timeStr;
  } catch (e) {
    console.error(e);
    const fallback = "Check shul board";
    ["weekdayMinchaMaariv", "weekdayMinchaMaarivCard", "heroWeekdayMincha"]
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = fallback;
      });
  }
}

async function updateShabbosTimes() {
  const today = new Date();
  const shabbos = getComingShabbos(today);

  try {
    const sunset = getSunsetWithCalibration(shabbos);
    if (!sunset) throw new Error("No Shabbos sunset");

    // Erev Shabbos Mincha: 15 minutes before shkiya
    const erevMincha = new Date(sunset.getTime() - 15 * 60 * 1000);
    // Shabbos day Mincha: 45 minutes before shkiya
    const shabbosMincha = new Date(sunset.getTime() - 45 * 60 * 1000);
    // Motzaei Shabbos Maariv: 50 minutes after shkiya
    const maariv = new Date(sunset.getTime() + 50 * 60 * 1000);

    const erevMinchaStr = formatTimeLocal(erevMincha);
    const shabbosMinchaStr = formatTimeLocal(shabbosMincha);
    const maarivStr = formatTimeLocal(maariv);

    const erevMinchaEl = document.getElementById("erevShabbosMinchaTime");
    const shMincha = document.getElementById("shabbosMinchaTime");
    const shMaariv = document.getElementById("shabbosMaarivTime");
    const heroMincha = document.getElementById("heroShabbosMincha");
    const heroMaariv = document.getElementById("heroShabbosMaariv");

    if (erevMinchaEl) erevMinchaEl.textContent = erevMinchaStr;
    if (shMincha) shMincha.textContent = shabbosMinchaStr;
    if (shMaariv) shMaariv.textContent = maarivStr;
    if (heroMincha) heroMincha.textContent = shabbosMinchaStr; // hero shows Shabbos-day Mincha
    if (heroMaariv) heroMaariv.textContent = maarivStr;
  } catch (e) {
    console.error(e);
    const fallback = "See local listing";
    [
      "erevShabbosMinchaTime",
      "shabbosMinchaTime",
      "shabbosMaarivTime",
      "heroShabbosMincha",
      "heroShabbosMaariv"
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = fallback;
    });
  }
}
async function updateParsha() {
  const parshaEl = document.getElementById("parshaName");
  if (!parshaEl) return;

  try {
    // Hebcal Shabbat API for your coordinates (Mt Ivy area), diaspora
    const url =
      "https://www.hebcal.com/shabbat?cfg=json&geo=pos&latitude=41.19392515448243&longitude=-74.02504208449552&m=50&leyning=on";

    const res = await fetch(url);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();

    // Look for the parsha item
    const parshaItem = data.items.find((item) => item.category === "parashat");

    if (parshaItem) {
      // Prefer Hebrew name if available
      parshaEl.textContent = parshaItem.hebrew || parshaItem.title || "—";
    } else {
      parshaEl.textContent = "—";
    }
  } catch (err) {
    console.error("Error fetching parsha:", err);
    parshaEl.textContent = "—";
  }
}
document.addEventListener("DOMContentLoaded", () => {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  CAL_OFFSET_MS = computeCalibrationOffsetMs();
  updateWeekdayMinchaMaariv();
  updateShabbosTimes();
  updateParsha();
});
