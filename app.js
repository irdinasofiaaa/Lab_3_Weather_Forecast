/**
 * app.js — WeatherNow Dashboard
 * Chapter 4 Lab Exercise 3
 *
 * Covers:
 *  - Fetch API with async/await (geocoding → weather chain)
 *  - jQuery $.getJSON() with .done()/.fail()/.always()
 *  - AbortController timeout (10s)
 *  - Debounce on search input (500ms)
 *  - Skeleton loading states
 *  - HTTP & network error handling with retry
 *  - Input validation (< 2 characters)
 *  - Celsius / Fahrenheit toggle (no new API call)
 *  - localStorage recent searches (last 5 cities)
 */

/* ─────────────────────────────────────────────
   CONSTANTS & STATE
───────────────────────────────────────────── */
const GEO_URL      = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_URL  = 'https://api.open-meteo.com/v1/forecast';
const TIME_URL     = 'https://worldtimeapi.org/api/timezone';

/** Stored raw weather data so unit toggle needs no API call */
let weatherCache = null;

/** Currently displayed unit: 'C' or 'F' */
let currentUnit = 'C';

/** Last successful search city for retry support */
let lastSearchCity = '';

/** WeatherCode → { description, emoji } */
//reference: https://www.meteomatics.com/en/api/available-parameters/weather-parameter/general-weather-state/
const WEATHER_CODES = {
  0:  { desc: 'Clear sky',               emoji: '☀️'  },
  1:  { desc: 'Mainly clear',            emoji: '🌤️' },
  2:  { desc: 'Partly cloudy',           emoji: '⛅'  },
  3:  { desc: 'Overcast',               emoji: '☁️'  },
  45: { desc: 'Foggy',                  emoji: '🌫️' },
  48: { desc: 'Icy fog',               emoji: '🌫️' },
  51: { desc: 'Light drizzle',          emoji: '🌦️' },
  53: { desc: 'Moderate drizzle',       emoji: '🌦️' },
  55: { desc: 'Dense drizzle',          emoji: '🌧️' },
  61: { desc: 'Slight rain',            emoji: '🌧️' },
  63: { desc: 'Moderate rain',          emoji: '🌧️' },
  65: { desc: 'Heavy rain',             emoji: '🌧️' },
  71: { desc: 'Slight snow',            emoji: '❄️'  },
  73: { desc: 'Moderate snow',          emoji: '🌨️' },
  75: { desc: 'Heavy snow',             emoji: '🌨️' },
  77: { desc: 'Snow grains',            emoji: '🌨️' },
  80: { desc: 'Slight showers',         emoji: '🌦️' },
  81: { desc: 'Moderate showers',       emoji: '🌧️' },
  82: { desc: 'Violent showers',        emoji: '⛈️' },
  85: { desc: 'Snow showers',           emoji: '🌨️' },
  86: { desc: 'Heavy snow showers',     emoji: '🌨️' },
  95: { desc: 'Thunderstorm',           emoji: '⛈️' },
  96: { desc: 'Thunderstorm w/ hail',   emoji: '⛈️' },
  99: { desc: 'Thunderstorm w/ heavy hail', emoji: '⛈️' },
};

/* ── Theme labels shown in the badge ── */
const THEME_LABELS = {
  'w-clear':   '☀️ Clear sky',
  'w-cloudy':  '☁️ Cloudy',
  'w-foggy':   '🌫️ Foggy',
  'w-rainy':   '🌧️ Rainy',
  'w-snowy':   '❄️ Snowy',
  'w-stormy':  '⛈️ Stormy',
};

/* All weather theme classes — used to remove old before adding new */
const ALL_THEMES = Object.keys(THEME_LABELS);

/* ──────────────────────────────────────────
   APPLY WEATHER THEME
   Removes existing weather class, adds new one,
   updates the badge label.
────────────────────────────────────────── */
function applyWeatherTheme(weatherCode) {
  const entry = WEATHER_CODES[weatherCode] || { theme: 'w-clear' };
  const theme = entry.theme;

  /* Remove all old theme classes then add the new one */
  document.body.classList.remove(...ALL_THEMES);
  document.body.classList.add(theme);

  /* Update the badge in the corner */
  const badge = document.getElementById('weather-badge');
  if (badge) {
    badge.textContent = THEME_LABELS[theme] || theme;
  }
}

/* ── Debounce ── */
function debounce(fn, delay) {
  let timerId;
  return function (...args) {
    clearTimeout(timerId);
    timerId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/* ── Temperature helpers ── */
function toF(celsius) { return Math.round((celsius * 9 / 5) + 32); }
function formatTemp(celsius) {
  return currentUnit === 'C'
    ? `${Math.round(celsius)}°C`
    : `${toF(celsius)}°F`;
}

/* ── Skeleton helpers ── */
function showSkeletons() {
  ['city-name','local-time','weather-desc','weather-icon','temperature','humidity','windspeed']
    .forEach(id => document.getElementById(id).classList.add('skeleton'));

  const row = document.getElementById('forecast-row');
  row.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    row.insertAdjacentHTML('beforeend', `
      <div class="forecast-card">
        <div class="forecast-day skeleton">---</div>
        <div class="forecast-icon skeleton">--</div>
        <div class="forecast-high skeleton">--°</div>
        <div class="forecast-low skeleton">--°</div>
      </div>`);
  }
}

function removeSkeletons() {
  document.querySelectorAll('.skeleton').forEach(el => el.classList.remove('skeleton'));
}

/* ─────────────────────────────────────────────
   ERROR BANNER
───────────────────────────────────────────── */
function showError(msg) {
  document.getElementById('error-message').textContent = `⚠ ${msg}`;
  document.getElementById('error').classList.remove('hidden');
}

// Hide the error banner (CSS .hidden sets display:none)
function dismissError() {
  document.getElementById('error').classList.add('hidden');
}

// Re-run the last query; guard prevents retry when no search has been made yet
function retrySearch() {
  dismissError();
  if (lastSearchCity) search(lastSearchCity);
}


/* ── Validation message ── */
function showValidation(msg) {
  let el = document.getElementById('validation-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'validation-msg';
    el.className = 'validation-msg';
    document.querySelector('.search-wrap').insertAdjacentElement('afterend', el);
  }
  el.textContent = msg;
  setTimeout(() => { if (el) el.remove(); }, 3000);
}

/* ── Recent searches ── */
const STORAGE_KEY = 'weathernow_recent';
function getRecent() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}
function saveRecent(city) {
  let list = getRecent().filter(c => c.toLowerCase() !== city.toLowerCase());
  list.unshift(city);
  list = list.slice(0, 5);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
  renderRecent();
}
function renderRecent() {
  const list = getRecent();
  const wrap = document.getElementById('recent-wrap');
  const chips = document.getElementById('recent-chips');
  if (!list.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  chips.innerHTML = list
    .map(c => `<button class="chip" onclick="search('${c.replace(/'/g,"\\'")}')">${c}</button>`)
    .join('');
}

/* ── Fetch with AbortController timeout ── */
async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    return response.json();
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('Request timed out after 10 seconds.');
    throw err;
  }
}

/* ── Geocoding → Weather chain ── */
async function fetchWeather(cityQuery) {
  const geoData = await fetchWithTimeout(
    `${GEO_URL}?name=${encodeURIComponent(cityQuery)}&count=1&language=en&format=json`
  );
  if (!geoData.results || geoData.results.length === 0) {
    removeSkeletons();
    showError(`No city found for "${cityQuery}". Please check the spelling.`);
    return null;
  }
  const { name, latitude, longitude, timezone } = geoData.results[0];
  const params = new URLSearchParams({
    latitude, longitude,
    current_weather: true,
    hourly:  'temperature_2m,relativehumidity_2m,windspeed_10m',
    daily:   'temperature_2m_max,temperature_2m_min,weathercode',
    timezone: 'auto',
  });
  const weatherData = await fetchWithTimeout(`${WEATHER_URL}?${params}`);
  return { name, latitude, longitude, timezone, weatherData };
}

/* ── jQuery AJAX: local time ── */
function fetchLocalTime(timezone) {
  $.getJSON(`${TIME_URL}/${encodeURIComponent(timezone)}`)
    .done(function (data) {
      const dt = new Date(data.datetime);
      document.getElementById('local-time').textContent =
        `🕐 ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })} (local)`;
    })
    .fail(function () {
      document.getElementById('local-time').textContent =
        `🕐 ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })} (browser time)`;
    })
    .always(function () {
      console.log(`[WeatherNow] WorldTimeAPI request completed at ${new Date().toISOString()}`);
    });
}

/* ── Populate current weather ── */
function populateCurrentWeather(name, weatherData) {
  const cw   = weatherData.current_weather;
  const code = WEATHER_CODES[cw.weathercode] || { desc: 'Unknown', emoji: '🌡️', theme: 'w-clear' };

  /* ★ Apply the dynamic theme based on weather condition */
  applyWeatherTheme(cw.weathercode);

  const hourlyTimes = weatherData.hourly.time;
  const now         = new Date().toISOString().slice(0, 13);
  const hIdx        = hourlyTimes.findIndex(t => t.startsWith(now));
  const humidity    = hIdx !== -1 ? weatherData.hourly.relativehumidity_2m[hIdx] : '--';

  weatherCache = {
    name,
    tempC:       cw.temperature,
    humidity,
    windspeed:   cw.windspeed,
    weatherCode: cw.weathercode,
    daily:       weatherData.daily,
  };

  document.getElementById('city-name').textContent    = name;
  document.getElementById('weather-desc').textContent  = code.desc;
  document.getElementById('weather-icon').textContent  = code.emoji;
  document.getElementById('temperature').textContent   = formatTemp(cw.temperature);
  document.getElementById('humidity').textContent      = `💧 ${humidity}%`;
  document.getElementById('windspeed').textContent     = `💨 ${Math.round(cw.windspeed)} km/h`;
}

/* ── Populate 7-day forecast ── */
function populateForecast(daily) {
  const row  = document.getElementById('forecast-row');
  row.innerHTML = '';
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (let i = 0; i < 7; i++) {
    const date  = new Date(daily.time[i] + 'T12:00:00');
    const code  = WEATHER_CODES[daily.weathercode[i]] || { emoji: '🌡️' };
    row.insertAdjacentHTML('beforeend', `
      <div class="forecast-card" style="animation-delay:${i * 60}ms">
        <div class="forecast-day">${days[date.getDay()]}</div>
        <div class="forecast-icon">${code.emoji}</div>
        <div class="forecast-high">${formatTemp(daily.temperature_2m_max[i])}</div>
        <div class="forecast-low">${formatTemp(daily.temperature_2m_min[i])}</div>
      </div>`);
  }
}

/* ── Unit toggle ── */
function setUnit(unit) {
  currentUnit = unit;
  document.getElementById('btn-c').classList.toggle('active', unit === 'C');
  document.getElementById('btn-f').classList.toggle('active', unit === 'F');
  if (!weatherCache) return;
  document.getElementById('temperature').textContent = formatTemp(weatherCache.tempC);
  populateForecast(weatherCache.daily);
}

/* ── Main search orchestrator ── */
async function search(cityQuery) {
  cityQuery = cityQuery.trim();
  if (cityQuery.length < 2) { showValidation('Please enter at least 2 characters.'); return; }

  dismissError();
  lastSearchCity = cityQuery;
  showSkeletons();

  try {
    const result = await fetchWeather(cityQuery);
    if (!result) return;
    const { name, timezone, weatherData } = result;
    removeSkeletons();
    populateCurrentWeather(name, weatherData);
    populateForecast(weatherData.daily);
    fetchLocalTime(timezone);
    saveRecent(name);
  } catch (err) {
    removeSkeletons();
    showError(err.message || 'An unexpected error occurred.');
    console.error('[WeatherNow]', err);
  }
}

/* ── Event listeners & startup ── */
function triggerSearch() {
  search(document.getElementById('city-input').value);
}

const debouncedSearch = debounce(() => {
  const val = document.getElementById('city-input').value.trim();
  if (val.length >= 2) search(val);
}, 500);

document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('city-input');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') triggerSearch(); });
  input.addEventListener('input', debouncedSearch);
  renderRecent();
  search('Kuala Lumpur');
});