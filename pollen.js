/**
 * Cloudflare Pages Function: /api/pollen
 * Serverless proxy for Google Pollen API to keep the API key private.
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
        "Content-Type": "application/json"
    };

    // Validate environment variable
    const apiKey = env.GOOGLE_POLLEN_API_KEY;
    if (!apiKey) {
        return new Response(
            JSON.stringify({ error: "Missing GOOGLE_POLLEN_API_KEY environment variable in Cloudflare Pages." }),
            { status: 500, headers: corsHeaders }
        );
    }

    // Validate coordinates
    if (!lat || !lon || isNaN(parseFloat(lat)) || isNaN(parseFloat(lon))) {
        return new Response(
            JSON.stringify({ error: "Invalid or missing lat and lon query parameters." }),
            { status: 400, headers: corsHeaders }
        );
    }

    // Server-side fetch to Google Pollen API
    const googleUrl = `https://pollen.googleapis.com/v1/forecast:lookup?key=${apiKey}&days=5&languageCode=en&location.latitude=${encodeURIComponent(lat)}&location.longitude=${encodeURIComponent(lon)}`;

    try {
        const googleRes = await fetch(googleUrl);
        const data = await googleRes.text();

        return new Response(data, {
            status: googleRes.status,
            headers: corsHeaders
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
