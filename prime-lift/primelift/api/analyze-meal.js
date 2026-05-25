// ============================================================
// PrimeLift — AI Meal Photo Analyzer
// Vercel Serverless Function  →  calls Google Gemini (FREE)
// Set GEMINI_API_KEY in Vercel dashboard → Environment Variables
// Get a free key at: https://aistudio.google.com/app/apikey
// ============================================================

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is not configured. Add it in Vercel → Project Settings → Environment Variables.",
    });
  }

  const { imageBase64, mimeType = "image/jpeg" } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: "Missing imageBase64" });

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

  try {
    const apiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mimeType, data: imageBase64 } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: { maxOutputTokens: 512, temperature: 0.2 },
        }),
      }
    );

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error("Gemini error:", errText);
      return res.status(502).json({ error: "AI API returned an error", detail: errText });
    }

    const data = await apiRes.json();
    const rawText = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: "Could not parse AI response", raw: rawText });
    }

    return res.status(200).json(JSON.parse(jsonMatch[0]));
  } catch (err) {
    console.error("Function error:", err);
    return res.status(500).json({ error: "Server error", detail: err.message });
  }
};
