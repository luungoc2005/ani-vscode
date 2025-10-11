import * as vscode from 'vscode';
import * as https from 'https';
import { IPlugin, PluginContext, PluginMessage } from './IPlugin';
import { hasInternetConnectivityCached } from './common/connectivity';

interface Coordinates {
  latitude: number;
  longitude: number;
  displayName: string;
  timezone?: string;
}

interface WeatherSnapshot {
  locationName: string;
  timestamp: string;
  timezone?: string;
  weatherCode: number;
  description: string;
  temperatureC: number;
  apparentTemperatureC?: number;
  humidityPercent?: number;
  windSpeedKph?: number;
  precipitationMm?: number;
}

export class WeatherPlugin implements IPlugin {
  readonly id = 'weather';
  readonly name = 'Weather Watcher';

  private lastObservations = new Map<string, WeatherSnapshot>();
  private locationCache = new Map<string, Coordinates>();
  private locationErrorNotified = new Set<string>();
  private weatherCache = new Map<string, { snapshot: WeatherSnapshot; fetchedAt: number }>();

  isEnabled(config: vscode.WorkspaceConfiguration): boolean {
    return config.get<boolean>('plugins.weather.enabled', true);
  }

  getWeight(config: vscode.WorkspaceConfiguration): number {
    return config.get<number>('plugins.weather.weight', 1) ?? 1;
  }

  async shouldTrigger(context: PluginContext): Promise<boolean> {
    if (!(await hasInternetConnectivityCached())) {
      return false;
    }

    const cfg = vscode.workspace.getConfiguration('ani-vscode');
    const rawLocation = (cfg.get<string>('plugins.weather.location', 'Tokyo, Japan') || '').trim();
    if (!rawLocation) {
      return false;
    }

    const cacheMinutes = Math.max(30, cfg.get<number>('plugins.weather.cacheMinutes', 30) ?? 30);
    const locationKey = this.normalizeLocationKey(rawLocation);

    const coords = await this.resolveCoordinates(rawLocation, locationKey);
    if (!coords) {
      if (!this.locationErrorNotified.has(locationKey)) {
        context.enqueueMessage(
          `Ani's weather senses are jammed—I couldn't resolve the location "${rawLocation}". Try setting "ani-vscode.plugins.weather.location" to a city or "lat,lon".`,
          { priority: true }
        );
        this.locationErrorNotified.add(locationKey);
      }
      return false;
    }

    this.locationErrorNotified.delete(locationKey);

    const weather = await this.getWeatherSnapshot(locationKey, coords, cacheMinutes);
    if (!weather) {
      return false;
    }

    const previous = this.lastObservations.get(locationKey) ?? null;
    if (!previous) {
      return true;
    }

    return this.hasSignificantChange(previous, weather);
  }

  async generateMessage(context: PluginContext): Promise<PluginMessage | null> {
    try {
      const cfg = vscode.workspace.getConfiguration('ani-vscode');
      const rawLocation = (cfg.get<string>('plugins.weather.location', 'Tokyo, Japan') || '').trim();
      if (!rawLocation) {
        return null;
      }

      const cacheMinutes = Math.max(30, cfg.get<number>('plugins.weather.cacheMinutes', 30) ?? 30);
      const locationKey = this.normalizeLocationKey(rawLocation);

      const coords = await this.resolveCoordinates(rawLocation, locationKey);
      if (!coords) {
        if (!this.locationErrorNotified.has(locationKey)) {
          context.enqueueMessage(
            `Ani's weather senses are jammed—I couldn't resolve the location "${rawLocation}". Try setting "ani-vscode.plugins.weather.location" to a city or "lat,lon".`,
            { priority: true }
          );
          this.locationErrorNotified.add(locationKey);
        }
        return null;
      }

      this.locationErrorNotified.delete(locationKey);

      const weather = await this.getWeatherSnapshot(locationKey, coords, cacheMinutes);
      if (!weather) {
        return null;
      }

      const previous = this.lastObservations.get(locationKey) ?? null;
      const changed = !previous || this.hasSignificantChange(previous, weather);
      this.lastObservations.set(locationKey, weather);

      if (!changed) {
        return null;
      }

      const userPrompt = this.buildPrompt(weather, previous);

      return {
        userPrompt,
        includeContext: false
      };
    } catch (error) {
      console.error('WeatherPlugin error:', error);
      return null;
    }
  }

  private normalizeLocationKey(input: string): string {
    return input.trim().toLowerCase();
  }

  private async resolveCoordinates(input: string, locationKey: string): Promise<Coordinates | null> {
    if (this.locationCache.has(locationKey)) {
      return this.locationCache.get(locationKey)!;
    }

    const coordMatch = input.match(/^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
    if (coordMatch) {
      const latitude = Number(coordMatch[1]);
      const longitude = Number(coordMatch[2]);
      const coords: Coordinates = {
        latitude,
        longitude,
        displayName: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`,
        timezone: 'auto'
      };
      this.locationCache.set(locationKey, coords);
      return coords;
    }

    const encoded = encodeURIComponent(input);
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encoded}&count=1&language=en&format=json`;
    try {
      const data = await this.fetchJson(url);
      const result = data?.results?.[0];
      if (!result) {
        return null;
      }
      const displayParts = [result.name];
      if (result.admin1 && result.admin1 !== result.name) {
        displayParts.push(result.admin1);
      }
      if (result.country) {
        displayParts.push(result.country);
      }
      const coords: Coordinates = {
        latitude: Number(result.latitude),
        longitude: Number(result.longitude),
        displayName: displayParts.filter(Boolean).join(', '),
        timezone: result.timezone || 'auto'
      };
      this.locationCache.set(locationKey, coords);
      return coords;
    } catch (error) {
      console.error('WeatherPlugin geocoding error:', error);
      return null;
    }
  }

  private async getWeatherSnapshot(
    locationKey: string,
    coords: Coordinates,
    cacheMinutes: number
  ): Promise<WeatherSnapshot | null> {
    const cacheEntry = this.weatherCache.get(locationKey);
    const now = Date.now();
    const ttlMs = cacheMinutes * 60 * 1000;

    if (cacheEntry && now - cacheEntry.fetchedAt < ttlMs) {
      return cacheEntry.snapshot;
    }

    const snapshot = await this.fetchCurrentWeather(coords);
    if (!snapshot) {
      if (cacheEntry) {
        return cacheEntry.snapshot;
      }
      return null;
    }

    this.weatherCache.set(locationKey, { snapshot, fetchedAt: now });
    return snapshot;
  }

  private async fetchCurrentWeather(coords: Coordinates): Promise<WeatherSnapshot | null> {
    const params = new URLSearchParams({
      latitude: coords.latitude.toString(),
      longitude: coords.longitude.toString(),
      current: 'temperature_2m,apparent_temperature,weathercode,relative_humidity_2m,wind_speed_10m,precipitation',
      timezone: coords.timezone || 'auto'
    });
    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

    try {
      const data = await this.fetchJson(url);
      const current = data?.current;
      if (!current) {
        return null;
      }

      const weatherCode = Number(current.weathercode ?? current.weather_code ?? 0);
      const description = this.describeWeatherCode(weatherCode);

      return {
        locationName: coords.displayName,
        timestamp: String(current.time || data.current_units?.time),
        timezone: coords.timezone,
        weatherCode,
        description,
        temperatureC: typeof current.temperature_2m === 'number' ? current.temperature_2m : Number(current.temperature_2m),
        apparentTemperatureC: typeof current.apparent_temperature === 'number' ? current.apparent_temperature : Number(current.apparent_temperature),
        humidityPercent: typeof current.relative_humidity_2m === 'number' ? current.relative_humidity_2m : Number(current.relative_humidity_2m),
        windSpeedKph: typeof current.wind_speed_10m === 'number' ? current.wind_speed_10m : Number(current.wind_speed_10m),
        precipitationMm: typeof current.precipitation === 'number' ? current.precipitation : Number(current.precipitation)
      };
    } catch (error) {
      console.error('WeatherPlugin fetch error:', error);
      return null;
    }
  }

  private hasSignificantChange(previous: WeatherSnapshot, current: WeatherSnapshot): boolean {
    if (previous.weatherCode !== current.weatherCode) {
      return true;
    }

    if (this.isWet(previous.weatherCode) !== this.isWet(current.weatherCode)) {
      return true;
    }

    const tempDiff = Math.abs((previous.temperatureC ?? 0) - (current.temperatureC ?? 0));
    if (tempDiff >= 1.5) {
      return true;
    }

    const apparentDiff = Math.abs((previous.apparentTemperatureC ?? previous.temperatureC ?? 0) - (current.apparentTemperatureC ?? current.temperatureC ?? 0));
    if (apparentDiff >= 2.0) {
      return true;
    }

    const humidityDiff = Math.abs((previous.humidityPercent ?? 0) - (current.humidityPercent ?? 0));
    if (humidityDiff >= 12) {
      return true;
    }

    const windDiff = Math.abs((previous.windSpeedKph ?? 0) - (current.windSpeedKph ?? 0));
    if (windDiff >= 8) {
      return true;
    }

    const precipitationDiff = Math.abs((previous.precipitationMm ?? 0) - (current.precipitationMm ?? 0));
    if (precipitationDiff >= 0.5) {
      return true;
    }

    return false;
  }

  private buildPrompt(current: WeatherSnapshot, previous: WeatherSnapshot | null): string {
    const timeLabel = this.renderTime(current.timestamp, current.timezone);
    const currentLine = `Current conditions in ${current.locationName}: ${current.description.toLowerCase()} with ${current.temperatureC.toFixed(1)}°C` +
      (typeof current.humidityPercent === 'number' ? `, humidity ${Math.round(current.humidityPercent)}%` : '') +
      (typeof current.windSpeedKph === 'number' ? `, wind ${Math.round(current.windSpeedKph)} km/h` : '') +
      (typeof current.precipitationMm === 'number' && current.precipitationMm > 0.01 ? `, precipitation ${current.precipitationMm.toFixed(1)} mm` : '') +
      ` as of ${timeLabel}.`;

    let changeLine: string;
    if (previous) {
      const prevTime = this.renderTime(previous.timestamp, previous.timezone);
      const prevSummary = `${previous.description.toLowerCase()} around ${previous.temperatureC.toFixed(1)}°C`;
      const trend = this.describeTrend(previous, current);
      changeLine = `Previously it was ${prevSummary} at ${prevTime}. Since then ${trend}.`;
    } else {
      changeLine = 'This is the first weather check of the session, so highlight why these conditions matter.';
    }

    return [
      currentLine,
      changeLine,
      'Share a warm, conversational weather update that ties the shift to how the coding session might feel. Keep it short, avoid repeating raw numbers verbatim, and end with an encouraging nudge to stay productive.'
    ].join('\n');
  }

  private describeTrend(previous: WeatherSnapshot, current: WeatherSnapshot, options?: { short?: boolean }): string {
    const tempDelta = current.temperatureC - previous.temperatureC;
    const tempDirection = tempDelta > 0 ? 'warmer' : tempDelta < 0 ? 'cooler' : 'similar';
    const codeChanged = previous.weatherCode !== current.weatherCode;

    const fragments: string[] = [];

    if (codeChanged) {
      fragments.push(`conditions shifted from ${previous.description.toLowerCase()} to ${current.description.toLowerCase()}`);
    }

    if (Math.abs(tempDelta) >= 0.5) {
      const magnitude = Math.abs(tempDelta) >= 5
        ? 'a lot '
        : Math.abs(tempDelta) >= 2
          ? 'noticeably '
          : '';
      const directionWord = tempDirection === 'warmer' ? 'warmer' : 'cooler';
      fragments.push(`${magnitude}${directionWord}`);
    }

    const humidityDelta = (current.humidityPercent ?? 0) - (previous.humidityPercent ?? 0);
    if (Math.abs(humidityDelta) >= 10) {
      fragments.push(humidityDelta > 0 ? 'more humid' : 'drier');
    }

    const windDelta = (current.windSpeedKph ?? 0) - (previous.windSpeedKph ?? 0);
    if (Math.abs(windDelta) >= 8) {
      fragments.push(windDelta > 0 ? 'wind picking up' : 'winds easing');
    }

    const precipChange = (current.precipitationMm ?? 0) - (previous.precipitationMm ?? 0);
    if (Math.abs(precipChange) >= 0.3) {
      fragments.push(precipChange > 0 ? 'rain moving in' : 'rain letting up');
    }

    if (fragments.length === 0) {
      return options?.short ? 'conditions shifted slightly' : 'conditions only nudged a little';
    }

    if (options?.short) {
      return fragments.join(', ');
    }

    const last = fragments.pop();
    return fragments.length > 0 ? `${fragments.join(', ')} and ${last}` : String(last);
  }

  private renderTime(timestamp: string | undefined, timezone?: string): string {
    if (!timestamp) {
      return 'just now';
    }

    try {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) {
        return 'just now';
      }

      const options: Intl.DateTimeFormatOptions = {
        hour: '2-digit',
        minute: '2-digit'
      };
      const formatter = new Intl.DateTimeFormat(undefined, {
        ...options,
        timeZone: timezone && timezone !== 'auto' ? timezone : undefined
      });
      return formatter.format(date);
    } catch {
      return 'just now';
    }
  }

  private isWet(code: number): boolean {
    return [
      51, 53, 55,
      56, 57,
      61, 63, 65,
      66, 67,
      71, 73, 75,
      80, 81, 82,
      85, 86,
      95, 96, 99
    ].includes(code);
  }

  private describeWeatherCode(code: number): string {
    const map: Record<number, string> = {
      0: 'Clear sky',
      1: 'Mainly clear',
      2: 'Partly cloudy',
      3: 'Overcast',
      45: 'Foggy',
      48: 'Rime fog',
      51: 'Light drizzle',
      53: 'Moderate drizzle',
      55: 'Dense drizzle',
      56: 'Freezing drizzle',
      57: 'Heavy freezing drizzle',
      61: 'Light rain',
      63: 'Moderate rain',
      65: 'Heavy rain',
      66: 'Freezing rain',
      67: 'Heavy freezing rain',
      71: 'Light snow',
      73: 'Moderate snow',
      75: 'Heavy snow',
      77: 'Snow grains',
      80: 'Light rain showers',
      81: 'Moderate rain showers',
      82: 'Violent rain showers',
      85: 'Light snow showers',
      86: 'Heavy snow showers',
      95: 'Thunderstorm',
      96: 'Thunderstorm with hail',
      99: 'Thunderstorm with heavy hail'
    };

    return map[code] || 'Unknown conditions';
  }

  private fetchJson(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      https
        .get(url, res => {
          if (!res || res.statusCode !== 200) {
            reject(new Error(`Request failed with status ${res?.statusCode}`));
            res.resume?.();
            return;
          }

          const chunks: Uint8Array[] = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            try {
              const raw = Buffer.concat(chunks).toString('utf8');
              resolve(JSON.parse(raw));
            } catch (error) {
              reject(error);
            }
          });
        })
        .on('error', reject);
    });
  }
}
