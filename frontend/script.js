const $ = id => document.getElementById(id);
const app = document.querySelector('.weather-app');
let request;
function weatherType(code) {
  if (code === 0) return ['clear', 'Clear Sky', 'sun'];
  if (code <= 2) return ['cloudy', 'Partly Cloudy', 'partly'];
  if (code === 3) return ['cloudy', 'Overcast', 'cloud'];
  if (code <= 48) return ['fog', 'Foggy', 'cloud'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', 'Snowy', 'snow'];
  if (code >= 95) return ['storm', 'Thunderstorm', 'rain'];
  return ['rain', 'Rainy', 'rain'];
}
async function getJSON(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Weather service unavailable. Please try again.');
  return response.json();
}
async function loadWeather(location) {
  request?.abort();
  request = new AbortController();
  const { signal } = request;
  const button = document.querySelector('#search-form button');
  button.disabled = true;
  app.setAttribute('aria-busy', 'true');
  $('status').textContent = 'Getting the latest weather…';
  try {
    let city = location;
    if (typeof location === 'string') {
      const query = new URLSearchParams({ name: location, count: '1', language: 'en', format: 'json' });
      const data = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?${query}`, signal);
      if (!data.results?.length) throw new Error('City not found. Try another name, or add the country.');
      city = data.results[0];
    }
    const params = new URLSearchParams({ latitude: city.latitude, longitude: city.longitude, current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m', hourly: 'visibility', forecast_days: '1', timezone: 'auto' });
    const data = await getJSON(`https://api.open-meteo.com/v1/forecast?${params}`, signal);
    const current = data.current;
    if (!current || !Number.isFinite(current.temperature_2m)) throw new Error('Weather data is unavailable for this city.');
    const [theme, description, icon] = weatherType(current.weather_code);
    app.dataset.theme = theme;
    app.dataset.night = String(current.is_day === 0);
    $('weather-symbol').setAttribute('href', `#${icon}`);
    $('city').textContent = city.name;
    $('data-label').textContent = `${city.country || 'Current weather'} · ${current.time.slice(11, 16)} local time`;
    $('temperature').textContent = `${Math.round(current.temperature_2m)}°C`;
    $('condition').textContent = description;
    $('feels-like').textContent = `Feels like ${Math.round(current.apparent_temperature)}°C`;
    $('humidity').textContent = `${current.relative_humidity_2m}%`;
    $('wind').textContent = `${Math.round(current.wind_speed_10m)} km/h`;
    const hourIndex = data.hourly?.time.findIndex(time => time.slice(0, 13) === current.time.slice(0, 13));
    const visibility = data.hourly?.visibility[hourIndex];
    $('visibility').textContent = Number.isFinite(visibility) ? `${Math.round(visibility / 100) / 10} km` : '—';
    $('status').textContent = '';
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('status').textContent = error instanceof TypeError ? 'Could not connect. Check your internet and search again.' : error.message;
  } finally {
    if (!signal.aborted) { button.disabled = false; app.setAttribute('aria-busy', 'false'); }
  }
}
$('search-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('city-input').value.trim();
  if (name.length >= 2) loadWeather(name);
});
loadWeather({ name: 'Ulaanbaatar', country: 'Mongolia', latitude: 47.9212, longitude: 106.9186 });
