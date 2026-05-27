interface WttrResponse {
  current_condition: Array<{
    temp_C: string;
    FeelsLikeC: string;
    humidity: string;
    weatherDesc: Array<{ value: string }>;
    windspeedKmph: string;
    winddir16Point: string;
    visibility: string;
  }>;
  nearest_area: Array<{
    areaName: Array<{ value: string }>;
    country: Array<{ value: string }>;
  }>;
  weather: Array<{
    date: string;
    maxtempC: string;
    mintempC: string;
    hourly: Array<{
      time: string;
      tempC: string;
      weatherDesc: Array<{ value: string }>;
      chanceofrain: string;
    }>;
  }>;
}

export async function getWeather(location: string): Promise<string> {
  const encoded = encodeURIComponent(location);
  const url = `https://wttr.in/${encoded}?format=j1&lang=zh`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Confer/1.0 weather-tool' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Weather API failed (${res.status})`);
  }

  const data = (await res.json()) as WttrResponse;
  const cur = data.current_condition[0];
  const area = data.nearest_area[0];
  const today = data.weather[0];

  const cityName = area?.areaName[0]?.value ?? location;
  const country = area?.country[0]?.value ?? '';
  const desc = cur?.weatherDesc[0]?.value ?? '未知';
  const tempC = cur?.temp_C ?? '-';
  const feelsLike = cur?.FeelsLikeC ?? '-';
  const humidity = cur?.humidity ?? '-';
  const windSpeed = cur?.windspeedKmph ?? '-';
  const windDir = cur?.winddir16Point ?? '';
  const visibility = cur?.visibility ?? '-';
  const maxTemp = today?.maxtempC ?? '-';
  const minTemp = today?.mintempC ?? '-';

  const lines = [
    `📍 ${cityName}${country ? `，${country}` : ''} 当前天气`,
    `🌤 天气状况：${desc}`,
    `🌡 温度：${tempC}°C（体感 ${feelsLike}°C）`,
    `📊 今日最高 ${maxTemp}°C / 最低 ${minTemp}°C`,
    `💧 湿度：${humidity}%`,
    `💨 风速：${windSpeed} km/h ${windDir}`,
    `👁 能见度：${visibility} km`,
  ];

  const forecast = data.weather.slice(1, 3);
  if (forecast.length > 0) {
    lines.push('');
    lines.push('未来天气：');
    for (const day of forecast) {
      const dayDesc = day.hourly[4]?.weatherDesc[0]?.value ?? '';
      lines.push(`  ${day.date}：${dayDesc}，${day.mintempC}°C ~ ${day.maxtempC}°C`);
    }
  }

  return lines.join('\n');
}

export const weatherToolDefinition = {
  name: 'get_weather',
  description: '获取指定城市或地区的实时天气信息，包括温度、湿度、风速和未来天气预报',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: '城市名称或地区，支持中文和英文，如"上海"、"Beijing"、"New York"',
      },
    },
    required: ['location'],
  },
} as const;
