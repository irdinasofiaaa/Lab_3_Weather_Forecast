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

/* ── Event listeners & startup ── */
function triggerSearch() {
  search(document.getElementById('city-input').value);
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