// ============================================================
// PrimeLift — AI Meal Photo Analyzer
// Netlify Function  →  calls Google Gemini (FREE tier)
// Set GEMINI_API_KEY in Netlify dashboard → Environment Variables
// Get a free key at: https://aistudio.google.com/app/apikey
// Free tier: 15 requests/min, 1M tokens/day — no credit card needed
// ============================================================

exports.handler = async (event) => {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "GEMINI_API_KEY is not configured in Netlify environment variables. Get a free key at https://aistudio.google.com/app/apikey" }),
    };
  }

  let imageBase64, mimeType;
  try {
    const parsed = JSON.parse(event.body || "{}");
    imageBase64 = parsed.imageBase64;
    mimeType = parsed.mimeType || "image/jpeg";
  } catch {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  if (!imageBase64) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "Missing imageBase64" }) };
  }

  const prompt = `You are a certified nutritionist. Carefully examine this meal photo and estimate its nutritional content for a typical single serving.

Return ONLY a valid JSON object — no markdown fences, no explanation, nothing outside the JSON:
{
  "meal_name": "Descriptive name of the dish",
  "calories": 450,
  "protein_g": 30,
  "carbs_g": 45,
  "fat_g": 15,
  "confidence": "medium",
  "notes": "e.g. Estimated for 1 standard serving. Rice portion assumed 1 cup cooked."
}

Rules:
- All numeric values must be whole integers.
- Estimate for a realistic single-person portion visible in the image.
- confidence: "high" if food is clearly identifiable, "medium" if somewhat clear, "low" if unclear or very mixed.
- If multiple foods are plated together, sum the nutrition for the full plate.
- Do NOT output anything outside the JSON object.`;

  const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  try {
    const apiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageBase64,
                },
              },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0.2,
        },
      }),
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error("Gemini API error:", errText);
      return {
        statusCode: 502,
        headers: CORS,
        body: JSON.stringify({ error: "AI API returned an error", detail: errText }),
      };
    }

    const data = await apiRes.json();
    const rawText = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();

    // Extract JSON robustly (strip any accidental markdown fences)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        statusCode: 500,
        headers: CORS,
        body: JSON.stringify({ error: "Could not parse AI response", raw: rawText }),
      };
    }

    const nutrition = JSON.parse(jsonMatch[0]);

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify(nutrition),
    };
  } catch (err) {
    console.error("Function error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: "Server error", detail: err.message }),
    };
  }
};
