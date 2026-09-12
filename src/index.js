/**
 * Cloudflare Worker Entry Point for mcmontague.com
 * Handles API routing with KV caching and passes static asset requests to Workers Static Assets.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "X-Data-Source",
  "Content-Type": "application/json"
};

/**
 * Handle CORS preflight requests
 */
function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    }
  });
}

/**
 * Handle /api/pollen requests:
 * 1. Validate lat/lon query parameters
 * 2. Check Cloudflare KV (POLLEN_KV) edge cache
 * 3. Fetch from Google Pollen API if cache miss / expired
 * 4. Save response to KV (8-hour TTL)
 */
async function handlePollen(request, env) {
  if (request.method === "OPTIONS") {
    return handleOptions();
  }

  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use GET." }),
      { status: 405, headers: CORS_HEADERS }
    );
  }

  const url = new URL(request.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");

  // Validate coordinates
  const latNum = parseFloat(lat);
  const lonNum = parseFloat(lon);
  if (!lat || !lon || isNaN(latNum) || isNaN(lonNum)) {
    return new Response(
      JSON.stringify({ error: "Invalid or missing lat and lon query parameters." }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Cache key rounded to 2 decimal places (~1.1km resolution)
  const cacheKey = `pollen_${latNum.toFixed(2)}_${lonNum.toFixed(2)}`;

  // 1. Check Cloudflare KV cache (POLLEN_KV)
  if (env.POLLEN_KV) {
    try {
      const cachedData = await env.POLLEN_KV.get(cacheKey, "json");
      if (cachedData && cachedData.dailyInfo && cachedData.dailyInfo.length > 0) {
        return new Response(JSON.stringify(cachedData), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "X-Data-Source": "edge-cache"
          }
        });
      }
    } catch (kvErr) {
      console.warn("Error reading from POLLEN_KV:", kvErr);
    }
  }

  // 2. Validate Google Pollen API Key from Worker environment
  const apiKey = env.GOOGLE_POLLEN_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Missing GOOGLE_POLLEN_API_KEY environment variable in Cloudflare Worker." }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // 3. Live Fetch from Google Pollen API
  const googleUrl = `https://pollen.googleapis.com/v1/forecast:lookup?key=${apiKey}&days=5&languageCode=en&location.latitude=${encodeURIComponent(lat)}&location.longitude=${encodeURIComponent(lon)}`;

  try {
    const googleRes = await fetch(googleUrl, {
      headers: {
        "Referer": "https://mcmontague.com/"
      }
    });

    if (!googleRes.ok) {
      const errorText = await googleRes.text();
      return new Response(errorText, {
        status: googleRes.status,
        headers: CORS_HEADERS
      });
    }

    const data = await googleRes.json();

    // Cache in KV for 8 hours (28,800 seconds) -> 3 updates per day
    if (env.POLLEN_KV && data && data.dailyInfo) {
      try {
        await env.POLLEN_KV.put(cacheKey, JSON.stringify(data), { expirationTtl: 28800 });
      } catch (kvPutErr) {
        console.warn("Failed to write pollen forecast to POLLEN_KV:", kvPutErr);
      }
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "X-Data-Source": "live-api"
      }
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Failed to connect to Google Pollen API.",
        details: err.message
      }),
      { status: 502, headers: CORS_HEADERS }
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Route: /api/pollen
    if (url.pathname === "/api/pollen" || url.pathname === "/api/pollen/") {
      return handlePollen(request, env);
    }

    // Pass all other requests to static assets (HTML, CSS, JS, images, videos)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};
