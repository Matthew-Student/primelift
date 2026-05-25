const MODELS = ["gemini-2.0-flash-exp","gemini-2.0-flash","gemini-1.5-flash-latest","gemini-1.5-flash-001","gemini-1.5-flash"];
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","Content-Type");
  res.setHeader("Access-Control-Allow-Methods","POST, OPTIONS");
  if (req.method==="OPTIONS") return res.status(204).end();
  if (req.method!=="POST") return res.status(405).end("Method Not Allowed");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({error:"GEMINI_API_KEY not configured"});
  const {imageBase64, mimeType="image/jpeg"} = req.body||{};
  if (!imageBase64) return res.status(400).json({error:"Missing imageBase64"});
  const prompt = `You are a nutritionist. Analyze this meal photo. Return ONLY valid JSON:\n{"meal_name":"name","calories":400,"protein_g":20,"carbs_g":50,"fat_g":10,"confidence":"medium","notes":"note"}`;
  const body = JSON.stringify({contents:[{parts:[{inline_data:{mime_type:mimeType,data:imageBase64}},{text:prompt}]}],generationConfig:{maxOutputTokens:256,temperature:0.2}});
  for (const model of MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,{method:"POST",headers:{"Content-Type":"application/json"},body});
    if (r.status===404) continue;
    if (!r.ok) { const e=await r.text(); return res.status(502).json({error:"API error",detail:e}); }
    const d=await r.json();
    const txt=(d.candidates?.[0]?.content?.parts?.[0]?.text||"").trim();
    const m=txt.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({error:"Bad AI response",raw:txt});
    return res.status(200).json(JSON.parse(m[0]));
  }
  return res.status(503).json({error:"No working Gemini model found"});
};
