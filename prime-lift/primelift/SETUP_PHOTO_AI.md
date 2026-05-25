# 📸 AI Photo Meal Tracker — Setup Guide

The photo analyzer calls **Google Gemini 1.5 Flash** via a Netlify serverless function.
Gemini has a **completely free tier** — no credit card required.

---

## Step 1 — Get a free Gemini API key

1. Go to https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click **Create API key**
4. Copy the key (starts with `AIza...`)

> **Free tier limits:** 15 requests/minute, 1 million tokens/day — more than enough for personal use.

---

## Step 2 — Add the key to Netlify

1. Go to your Netlify dashboard → select your PrimeLift site
2. **Site configuration → Environment variables**
3. Click **Add a variable**
4. Key: `GEMINI_API_KEY`
5. Value: `AIza...` (your key)
6. Click **Save**

---

## Step 3 — Redeploy

Push your code changes to GitHub (or drag & drop the updated folder to Netlify).
Netlify will automatically deploy the updated `netlify/functions/analyze-meal.js` function.

After deploy, the **📷 Log Meal with Photo** button in the Diet tab will be live.

---

## How it works

```
User takes photo → client resizes to 1024px → sends base64 to Netlify Function
→ Function calls Gemini 1.5 Flash (vision, free) → returns JSON nutrition estimate
→ User reviews & edits numbers → taps "Add to Log" → saved to Firestore
```

## Troubleshooting

| Problem | Fix |
|---|---|
| "GEMINI_API_KEY is not configured" error | Check that `GEMINI_API_KEY` is set in Netlify env vars and you redeployed |
| Button doesn't appear | Make sure you're on the Diet tab with your profile set up |
| Inaccurate estimates | The AI estimates based on visual appearance — edit the numbers before logging. Works best with a clear, well-lit photo of a single plate |
