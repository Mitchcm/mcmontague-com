/**
 * Cloudflare Pages Function: /api/pollen
 * Serverless proxy for Google Pollen API with Cloudflare KV edge caching.
 */
export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const lat = url.searchParams.get("lat");
    const lon = url.searchParams.get("lon");

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Expose-Headers": "X-Data-Source",
        "Content-Type": "application/json"
    };

    // 1. Cache Lookup: Check Cloudflare KV binding (POLLEN_KV)
    if (env.POLLEN_KV) {
        try {
            const cachedData = await env.POLLEN_KV.get('pollen_forecast', 'json');
            if (cachedData && cachedData.dailyInfo && cachedData.dailyInfo.length > 0) {
                return new Response(JSON.stringify(cachedData), {
                    status: 200,
                    headers: {
                        ...corsHeaders,
                        "X-Data-Source": "edge-cache"
                    }
                });
            }
        } catch (kvErr) {
            console.warn("Error reading from POLLEN_KV:", kvErr);
        }
    }

    // Validate coordinates
    if (!lat || !lon || isNaN(parseFloat(lat)) || isNaN(parseFloat(lon))) {
        return new Response(
            JSON.stringify({ error: "Invalid or missing lat and lon query parameters." }),
            { status: 400, headers: corsHeaders }
        );
    }

    // Validate API Key
    const apiKey = env.GOOGLE_POLLEN_API_KEY || "AIzaSyANwXHq5W2mHpyt111neFmh0zPQLN-AowM";
    if (!apiKey) {
        return new Response(
            JSON.stringify({ error: "Missing GOOGLE_POLLEN_API_KEY environment variable in Cloudflare Pages." }),
            { status: 500, headers: corsHeaders }
        );
    }

    // 2. Live Fetch & KV Save (Cache Miss / Expired)
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
                headers: corsHeaders
            });
        }

        const data = await googleRes.json();

        // Save JSON payload into KV with an expiration of 8 hours (28,800 seconds) -> 3 refreshes / day
        if (env.POLLEN_KV && data && data.dailyInfo) {
            try {
                await env.POLLEN_KV.put('pollen_forecast', JSON.stringify(data), { expirationTtl: 28800 });
            } catch (kvPutErr) {
                console.warn("Failed to write pollen forecast to POLLEN_KV:", kvPutErr);
            }
        }

        return new Response(JSON.stringify(data), {
            status: 200,
            headers: {
                ...corsHeaders,
                "X-Data-Source": "live-api"
            }
        });
    } catch (err) {
        return new Response(
            JSON.stringify({
                error: "Failed to connect to Google Pollen API.",
                details: err.message
            }),
            { status: 502, headers: corsHeaders }
        );
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type"
        }
    });
}
