// ============================================================
// PRIME LIFT — Production app.js
// Firebase v10 modular SDK via CDN
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, updateProfile, deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, addDoc, deleteDoc,
  collection, query, orderBy, limit, onSnapshot, getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db   = getFirestore(fbApp);

// ============================================================
// CONSTANTS
// ============================================================
const LIFTS = [
  { id: "bench",    name: "Bench"    },
  { id: "squat",    name: "Squat"    },
  { id: "deadlift", name: "Deadlift" },
  { id: "ohp",      name: "OHP"      },
  { id: "row",      name: "Row"      }
];
const KG_TO_LB = 2.2046226218;

// Tier thresholds — sum of Big 5 e1RMs ÷ bodyweight
const TIERS = [
  { level: 1, name: "RECRUIT",  ratio: 0,    color: "#cd7f32", desc: "Just starting" },
  { level: 2, name: "ADVOCATE", ratio: 2.5,  color: "#cbd5e1", desc: "Novice • 3-6 months" },
  { level: 3, name: "WARRIOR",  ratio: 4.5,  color: "#fbbf24", desc: "Intermediate • 1-2 yrs" },
  { level: 4, name: "CHAMPION", ratio: 6.0,  color: "#a855f7", desc: "Advanced • 3-5 yrs" },
  { level: 5, name: "TITAN",    ratio: 7.5,  color: "#4a4a4a", desc: "Elite • 5-10 yrs" },
  { level: 6, name: "OLYMPIAN", ratio: 9.0,  color: "#b9f2ff", desc: "World-class" }
];

const DAYS = [
  { id: "mon", name: "MON" }, { id: "tue", name: "TUE" }, { id: "wed", name: "WED" },
  { id: "thu", name: "THU" }, { id: "fri", name: "FRI" }, { id: "sat", name: "SAT" }, { id: "sun", name: "SUN" }
];

const ACTIVITY_LEVELS = [
  { id: "sedentary", name: "Sedentary",   multiplier: 1.2,   desc: "Desk job, no exercise" },
  { id: "light",     name: "Light",       multiplier: 1.375, desc: "Light exercise 1-3 days/wk" },
  { id: "moderate",  name: "Moderate",    multiplier: 1.55,  desc: "Moderate exercise 3-5 days/wk" },
  { id: "active",    name: "Very Active", multiplier: 1.725, desc: "Hard exercise 6-7 days/wk" },
  { id: "athlete",   name: "Athlete",     multiplier: 1.9,   desc: "Pro athlete / 2x daily training" }
];

const GOALS = [
  { id: "cut",      name: "Cut",      calOffset: -500, proteinPerKg: 2.4, fatPct: 0.25, label: "Lose Fat" },
  { id: "maintain", name: "Maintain", calOffset: 0,    proteinPerKg: 2.0, fatPct: 0.30, label: "Body Recomp" },
  { id: "bulk",     name: "Bulk",     calOffset: 400,  proteinPerKg: 2.0, fatPct: 0.25, label: "Build Muscle" }
];

// ============================================================
// FORMULAS — Epley e1RM, Mifflin-St Jeor BMR, BMI, Tier ratios
// ============================================================
function calcE1RM(w, r) {
  if (!w || !r || r < 1) return 0;
  const rr = Math.min(r, 12);
  return rr === 1 ? w : w * (1 + rr / 30);
}

function getTotalE1RM(prs) {
  return LIFTS.reduce((sum, l) => sum + (prs?.[l.id]?.e1rm || 0), 0);
}

function getTier(totalKg, bodyweightKg) {
  if (!bodyweightKg || bodyweightKg <= 0) return { ...TIERS[0], minKg: 0 };
  const ratio = totalKg / bodyweightKg;
  let tier = TIERS[0];
  for (const t of TIERS) if (ratio >= t.ratio) tier = t;
  return { ...tier, minKg: tier.ratio * bodyweightKg };
}

function getNextTier(currentLevel, bodyweightKg) {
  const next = TIERS.find(t => t.level === currentLevel + 1);
  if (!next || !bodyweightKg) return null;
  return { ...next, minKg: next.ratio * bodyweightKg };
}

function calcBMR(weightKg, heightCm, ageYears, sex) {
  if (!weightKg || !heightCm || !ageYears || !sex) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  return sex === "female" ? base - 161 : base + 5;
}

function calcTDEE(weightKg, heightCm, ageYears, sex, activityId) {
  const bmr = calcBMR(weightKg, heightCm, ageYears, sex);
  if (!bmr) return null;
  const activity = ACTIVITY_LEVELS.find(a => a.id === activityId);
  if (!activity) return null;
  return Math.round(bmr * activity.multiplier);
}

function calcMacroTargets(weightKg, heightCm, ageYears, sex, activityId, goalId) {
  const tdee = calcTDEE(weightKg, heightCm, ageYears, sex, activityId);
  if (!tdee) return null;
  const goal = GOALS.find(g => g.id === goalId);
  if (!goal) return null;
  const calories = Math.round(tdee + goal.calOffset);
  const proteinG = Math.round(weightKg * goal.proteinPerKg);
  const fatG     = Math.round((calories * goal.fatPct) / 9);
  const carbsG   = Math.max(0, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
  return { calories, protein: proteinG, carbs: carbsG, fats: fatG, tdee };
}

function getBMI(h, w) {
  if (!h || !w) return null;
  const m = h / 100;
  return w / (m * m);
}
function bmiCategory(bmi) {
  if (bmi < 18.5) return "Underweight";
  if (bmi < 25)   return "Normal";
  if (bmi < 30)   return "Overweight";
  return "Obese";
}

// ============================================================
// FOOD DATABASE (per portion macros, USDA-aligned)
// ============================================================
const FOODS = {
  protein: [
    { name: "Chicken Breast",     portion: "150g cooked",       cals: 240, p: 45, c: 0,  f: 5  },
    { name: "Whey Protein Shake", portion: "1 scoop + water",   cals: 120, p: 24, c: 3,  f: 1  },
    { name: "Greek Yogurt (0%)",  portion: "200g",              cals: 120, p: 20, c: 8,  f: 0  },
    { name: "Eggs (whole)",       portion: "3 large",           cals: 215, p: 18, c: 1,  f: 15 },
    { name: "Lean Ground Beef",   portion: "150g 90/10",        cals: 260, p: 35, c: 0,  f: 13 },
    { name: "Tuna (canned)",      portion: "1 can drained",     cals: 130, p: 30, c: 0,  f: 1  },
    { name: "Salmon Fillet",      portion: "150g",              cals: 280, p: 35, c: 0,  f: 15 },
    { name: "Cottage Cheese",     portion: "1 cup low-fat",     cals: 180, p: 28, c: 8,  f: 4  },
    { name: "Tofu (firm)",        portion: "150g",              cals: 175, p: 20, c: 4,  f: 10 }
  ],
  carbs: [
    { name: "White Rice (cooked)",   portion: "1 cup",     cals: 205, p: 4, c: 45, f: 0 },
    { name: "Sweet Potato (baked)",  portion: "1 medium",  cals: 115, p: 2, c: 27, f: 0 },
    { name: "Oats (dry)",            portion: "1/2 cup",   cals: 150, p: 5, c: 27, f: 3 },
    { name: "Whole Wheat Bread",     portion: "2 slices",  cals: 160, p: 8, c: 28, f: 2 },
    { name: "Banana",                portion: "1 large",   cals: 120, p: 1, c: 31, f: 0 },
    { name: "Pasta (cooked)",        portion: "1 cup",     cals: 220, p: 8, c: 43, f: 1 },
    { name: "Quinoa (cooked)",       portion: "1 cup",     cals: 220, p: 8, c: 39, f: 4 },
    { name: "Potato (boiled)",       portion: "200g",      cals: 155, p: 4, c: 35, f: 0 },
    { name: "Berries (mixed)",       portion: "1 cup",     cals: 70,  p: 1, c: 17, f: 0 }
  ],
  fats: [
    { name: "Almonds",          portion: "30g (24 nuts)",   cals: 175, p: 6, c: 6,  f: 15 },
    { name: "Avocado",          portion: "1/2 medium",      cals: 160, p: 2, c: 9,  f: 15 },
    { name: "Olive Oil",        portion: "1 tbsp",          cals: 120, p: 0, c: 0,  f: 14 },
    { name: "Peanut Butter",    portion: "2 tbsp",          cals: 190, p: 7, c: 8,  f: 16 },
    { name: "Walnuts",          portion: "30g (14 halves)", cals: 195, p: 5, c: 4,  f: 19 },
    { name: "Cheese (cheddar)", portion: "30g slice",       cals: 115, p: 7, c: 1,  f: 9  },
    { name: "Dark Chocolate",   portion: "30g 70%+",        cals: 170, p: 2, c: 13, f: 12 }
  ]
};

const QUICK_MEALS = [
  { name: "Chicken & Rice Bowl",          cals: 550, p: 50, c: 70, f: 10 },
  { name: "Protein Shake + Banana",       cals: 240, p: 25, c: 34, f: 1  },
  { name: "Eggs & Toast",                 cals: 380, p: 22, c: 30, f: 18 },
  { name: "Greek Yogurt + Berries + Oats", cals: 340, p: 25, c: 52, f: 4 },
  { name: "Salmon & Sweet Potato",        cals: 450, p: 38, c: 30, f: 18 },
  { name: "Tuna Sandwich",                cals: 380, p: 35, c: 30, f: 11 }
];

// ============================================================
// PHILIPPINE BUDGET MEAL PLANNER
// Prices: Metro Manila palengke / wet market (2024–2025 est.)
// Nutrition: FNRI Philippines Food Composition Tables
// ============================================================
const PH_MARKET = {
  proteins: [
    // id, Filipino name, buy description, cost (₱), servings per buy, cal/serving, protein/serving, carbs/serving, fat/serving
    { id:"egg",      name:"Itlog (Eggs)",                   buy:"1 dosenyo (dozen)", cost:96,  sv:12, cal:72,  p:6,  c:0,  f:5  },
    { id:"monggo",   name:"Monggo (Mung Beans 250g)",       buy:"1 pakete",          cost:22,  sv:4,  cal:105, p:7,  c:19, f:0  },
    { id:"sardinas", name:"Sardinas Ligo (155g)",           buy:"1 lata",            cost:30,  sv:2,  cal:96,  p:10, c:1,  f:6  },
    { id:"dilis",    name:"Tuyo Dilis / Dried Anchovies",   buy:"100g pakete",       cost:40,  sv:5,  cal:54,  p:11, c:0,  f:1  },
    { id:"tokwa",    name:"Tokwa / Firm Tofu (250g)",       buy:"1 bloke",           cost:28,  sv:3,  cal:61,  p:6,  c:2,  f:3  },
    { id:"tuna",     name:"Tuna 555 sa Lata (155g)",        buy:"1 lata",            cost:45,  sv:2,  cal:55,  p:12, c:0,  f:1  },
    { id:"tilapia",  name:"Tilapia (1 piraso ~200g)",       buy:"1 piraso",          cost:32,  sv:2,  cal:128, p:26, c:0,  f:3  },
    { id:"bangus",   name:"Bangus / Milkfish (medium)",     buy:"1 piraso",          cost:60,  sv:3,  cal:168, p:26, c:0,  f:7  },
    { id:"manok",    name:"Dibdib ng Manok / Chicken (250g)", buy:"250g",            cost:50,  sv:2,  cal:165, p:31, c:0,  f:4  },
  ],
  carbs: [
    { id:"bigas",    name:"Bigas (White Rice)",              buy:"1 kilo",           cost:50,  sv:14, cal:204, p:4,  c:45, f:0 },
    { id:"kamote",   name:"Kamote / Sweet Potato (1kg)",     buy:"1 kilo",           cost:45,  sv:7,  cal:114, p:2,  c:27, f:0 },
    { id:"saging",   name:"Saging Lakatan / Banana (6 pcs)", buy:"6 piraso",         cost:55,  sv:6,  cal:89,  p:1,  c:23, f:0 },
    { id:"pandesal", name:"Pandesal (12 piraso)",            buy:"1 dosenyo",        cost:60,  sv:12, cal:145, p:4,  c:27, f:3 },
    { id:"oatmeal",  name:"Oatmeal Quaker (500g)",           buy:"1 pakete",         cost:80,  sv:10, cal:148, p:5,  c:27, f:3 },
  ],
  vegs: [
    { id:"kangkong",  name:"Kangkong / Water Spinach",       buy:"1 bigkis",         cost:18,  sv:3,  cal:19,  p:3,  c:3,  f:0 },
    { id:"malunggay", name:"Malunggay / Moringa Leaves",     buy:"1 bigkis",         cost:15,  sv:4,  cal:64,  p:9,  c:8,  f:1 },
    { id:"pechay",    name:"Pechay / Bok Choy",              buy:"1 bigkis",         cost:20,  sv:3,  cal:13,  p:2,  c:2,  f:0 },
    { id:"sitaw",     name:"Sitaw / String Beans",           buy:"1 bigkis",         cost:22,  sv:3,  cal:31,  p:2,  c:7,  f:0 },
    { id:"camtops",   name:"Talbos ng Kamote / Sweet Pot. Tops", buy:"1 bigkis",    cost:15,  sv:3,  cal:43,  p:4,  c:8,  f:1 },
    { id:"ampalaya",  name:"Ampalaya / Bitter Gourd",        buy:"1 piraso",         cost:22,  sv:3,  cal:17,  p:1,  c:4,  f:0 },
  ],
};

const PH_PANTRY_FULL = [
  { name:"Mantika / Cooking Oil (350ml)",       cost:50 },
  { name:"Bawang + Sibuyas (Garlic + Onion)",   cost:24 },
  { name:"Toyo + Suka (Soy Sauce + Vinegar)",   cost:45 },
];
const PH_PANTRY_BASIC = [
  { name:"Mantika + Bawang (Basic cooking set)", cost:60 },
];

// Meal templates: each entry links a protein id + carb id + optional veg id to a Filipino dish
const PH_MEAL_TEMPLATES = {
  B: [ // Breakfast
    { p:"egg",     c:"bigas",    v:null,        name:"Sinangag at Itlog",       sub:"Garlic fried rice & fried egg" },
    { p:"sardinas",c:"bigas",    v:null,        name:"Sardinas at Kanin",        sub:"Sardines in tomato sauce + rice" },
    { p:"dilis",   c:"bigas",    v:null,        name:"Dilis at Kanin",           sub:"Dried anchovies + garlic rice" },
    { p:"egg",     c:"kamote",   v:"malunggay", name:"Itlog + Kamote",           sub:"Boiled egg + sweet potato + moringa" },
    { p:"egg",     c:"pandesal", v:null,        name:"Itlog at Pandesal",        sub:"Fried egg + fresh pandesal" },
    { p:"egg",     c:"oatmeal",  v:null,        name:"Oatmeal at Itlog",         sub:"Oatmeal + hard-boiled egg" },
    { p:"monggo",  c:"bigas",    v:"malunggay", name:"Lugaw na Monggo",          sub:"Mung bean rice porridge + moringa" },
    { p:"tuna",    c:"pandesal", v:null,        name:"Tuna Sandwich sa Pandesal",sub:"Canned tuna on warm pandesal" },
    { p:"dilis",   c:"kamote",   v:null,        name:"Dilis at Kamote",          sub:"Dried fish + boiled sweet potato" },
  ],
  L: [ // Lunch
    { p:"sardinas",c:"bigas", v:"kangkong",  name:"Sardinas + Ginisang Kangkong",   sub:"Sardines & sautéed water spinach" },
    { p:"monggo",  c:"bigas", v:"kangkong",  name:"Ginisang Monggo at Kanin",        sub:"Mung bean stew with kangkong" },
    { p:"tokwa",   c:"bigas", v:"sitaw",     name:"Adobong Tokwa at Sitaw",           sub:"Tofu & string beans in vinegar-soy" },
    { p:"tuna",    c:"bigas", v:"pechay",    name:"Tuna Guisado + Pechay",            sub:"Sautéed canned tuna + braised bok choy" },
    { p:"tilapia", c:"bigas", v:"malunggay", name:"Tinolang Tilapia",                 sub:"Tilapia in ginger-garlic-moringa broth" },
    { p:"bangus",  c:"bigas", v:"camtops",   name:"Sinabawang Bangus",                sub:"Milkfish soup + sweet potato tops" },
    { p:"egg",     c:"bigas", v:"kangkong",  name:"Torta + Ginisang Kangkong",        sub:"Egg omelette + sautéed water spinach" },
    { p:"manok",   c:"bigas", v:"pechay",    name:"Tinolang Manok",                   sub:"Chicken ginger-garlic broth + bok choy" },
    { p:"dilis",   c:"bigas", v:"kangkong",  name:"Dilis at Ginisang Kangkong",       sub:"Dried anchovies + stir-fried greens" },
    { p:"monggo",  c:"bigas", v:"malunggay", name:"Monggo Guisado",                   sub:"Sautéed mung beans with moringa leaves" },
    { p:"tilapia", c:"bigas", v:"sitaw",     name:"Pritong Tilapia at Sitaw",         sub:"Pan-fried tilapia + string beans" },
  ],
  D: [ // Dinner
    { p:"monggo",  c:"bigas", v:"malunggay", name:"Monggo Soup at Kanin",             sub:"Hearty mung bean soup with moringa" },
    { p:"sardinas",c:"bigas", v:"pechay",    name:"Sardinas + Pechay Guisado",        sub:"Sardines + braised bok choy" },
    { p:"tokwa",   c:"bigas", v:"kangkong",  name:"Ginisang Kangkong at Tokwa",       sub:"Stir-fried water spinach with tofu" },
    { p:"egg",     c:"bigas", v:"camtops",   name:"Ginisang Talbos ng Kamote",        sub:"Sautéed sweet potato tops with egg" },
    { p:"tilapia", c:"bigas", v:"sitaw",     name:"Adobong Isda at Sitaw",            sub:"Fish in vinegar-soy sauce + string beans" },
    { p:"bangus",  c:"bigas", v:"malunggay", name:"Sinigang na Bangus",               sub:"Milkfish in tamarind broth + moringa" },
    { p:"tuna",    c:"bigas", v:"kangkong",  name:"Tuna at Kangkong",                 sub:"Canned tuna with sautéed water spinach" },
    { p:"manok",   c:"bigas", v:"sitaw",     name:"Adobong Manok at Sitaw",           sub:"Chicken adobo + string beans" },
    { p:"dilis",   c:"bigas", v:"ampalaya",  name:"Pinakbet na may Dilis",            sub:"Vegetables stewed with dried anchovies" },
    { p:"egg",     c:"bigas", v:"ampalaya",  name:"Tortang Ampalaya",                 sub:"Bitter gourd omelette + steamed rice" },
    { p:"monggo",  c:"bigas", v:"kangkong",  name:"Monggo at Kangkong",               sub:"Mung bean stew with water spinach" },
  ],
};

// ============================================================
// ROUTINE RECOMMENDATIONS by BMI category
// ============================================================
function recommendedRoutine(bmi) {
  if (bmi == null) return null;
  if (bmi < 18.5) {
    return {
      mon: { exercises: [
        { name: "Bench Press", sets: 4, reps: "5-6" },
        { name: "Incline DB Press", sets: 3, reps: "8-10" },
        { name: "Barbell Row", sets: 4, reps: "5-6" },
        { name: "Tricep Dips", sets: 3, reps: "8-12" }
      ]},
      tue: { rest: true, note: "Eat big — surplus 500kcal" },
      wed: { exercises: [
        { name: "Squat", sets: 5, reps: "5" },
        { name: "Romanian Deadlift", sets: 3, reps: "8" },
        { name: "Leg Press", sets: 3, reps: "10" },
        { name: "Calf Raises", sets: 4, reps: "12" }
      ]},
      thu: { rest: true },
      fri: { exercises: [
        { name: "OHP", sets: 4, reps: "5-6" },
        { name: "Pull-ups", sets: 4, reps: "AMRAP" },
        { name: "DB Curls", sets: 3, reps: "10" },
        { name: "Lateral Raises", sets: 3, reps: "12" }
      ]},
      sat: { exercises: [
        { name: "Deadlift", sets: 4, reps: "5" },
        { name: "Front Squat", sets: 3, reps: "8" },
        { name: "Plank", sets: 3, reps: "60s" }
      ]},
      sun: { rest: true }
    };
  } else if (bmi < 25) {
    return {
      mon: { exercises: [
        { name: "Bench Press", sets: 4, reps: "6-8" },
        { name: "OHP", sets: 3, reps: "8" },
        { name: "Incline DB Press", sets: 3, reps: "10" },
        { name: "Tricep Pushdowns", sets: 3, reps: "12" },
        { name: "Lateral Raises", sets: 3, reps: "12-15" }
      ]},
      tue: { exercises: [
        { name: "Deadlift", sets: 4, reps: "5" },
        { name: "Barbell Row", sets: 4, reps: "6-8" },
        { name: "Lat Pulldown", sets: 3, reps: "10" },
        { name: "Face Pulls", sets: 3, reps: "15" },
        { name: "Barbell Curl", sets: 3, reps: "10" }
      ]},
      wed: { exercises: [
        { name: "Squat", sets: 4, reps: "6-8" },
        { name: "Romanian Deadlift", sets: 3, reps: "8" },
        { name: "Leg Press", sets: 3, reps: "12" },
        { name: "Leg Curl", sets: 3, reps: "12" },
        { name: "Calf Raises", sets: 4, reps: "15" }
      ]},
      thu: { exercises: [
        { name: "Incline Bench", sets: 4, reps: "8" },
        { name: "OHP", sets: 3, reps: "8-10" },
        { name: "Cable Fly", sets: 3, reps: "12" },
        { name: "Tricep Extensions", sets: 3, reps: "12" }
      ]},
      fri: { exercises: [
        { name: "Pull-ups", sets: 4, reps: "AMRAP" },
        { name: "T-bar Row", sets: 3, reps: "10" },
        { name: "DB Curls", sets: 3, reps: "10" },
        { name: "Hammer Curls", sets: 3, reps: "12" }
      ]},
      sat: { exercises: [
        { name: "Front Squat", sets: 4, reps: "6" },
        { name: "Bulgarian Splits", sets: 3, reps: "10/leg" },
        { name: "Calf Raises", sets: 4, reps: "15" }
      ]},
      sun: { rest: true }
    };
  } else if (bmi < 30) {
    return {
      mon: { exercises: [
        { name: "Squat", sets: 3, reps: "8" },
        { name: "Bench Press", sets: 3, reps: "8" },
        { name: "Barbell Row", sets: 3, reps: "10" },
        { name: "Plank", sets: 3, reps: "45s" }
      ]},
      tue: { exercises: [
        { name: "Cardio (Incline Walk)", sets: 1, reps: "30 min" },
        { name: "Core Circuit", sets: 3, reps: "15 reps" }
      ]},
      wed: { exercises: [
        { name: "Deadlift", sets: 3, reps: "6" },
        { name: "OHP", sets: 3, reps: "8" },
        { name: "Lat Pulldown", sets: 3, reps: "10" },
        { name: "Leg Curl", sets: 3, reps: "12" }
      ]},
      thu: { rest: true, note: "Active recovery — walk" },
      fri: { exercises: [
        { name: "Goblet Squat", sets: 3, reps: "10" },
        { name: "DB Press", sets: 3, reps: "10" },
        { name: "Cable Row", sets: 3, reps: "12" },
        { name: "Russian Twists", sets: 3, reps: "20" }
      ]},
      sat: { exercises: [{ name: "Cardio (HIIT)", sets: 1, reps: "20 min" }]},
      sun: { rest: true }
    };
  } else {
    return {
      mon: { exercises: [
        { name: "Walking", sets: 1, reps: "30 min" },
        { name: "Bodyweight Squat", sets: 3, reps: "10" },
        { name: "Wall Push-up", sets: 3, reps: "10" }
      ]},
      tue: { rest: true, note: "Stretching + walk" },
      wed: { exercises: [
        { name: "Walking", sets: 1, reps: "30 min" },
        { name: "Seated Row", sets: 3, reps: "12" },
        { name: "Leg Press (light)", sets: 3, reps: "12" }
      ]},
      thu: { rest: true },
      fri: { exercises: [
        { name: "Walking", sets: 1, reps: "30 min" },
        { name: "Goblet Squat (light)", sets: 3, reps: "10" },
        { name: "DB Press (light)", sets: 3, reps: "10" }
      ]},
      sat: { exercises: [{ name: "Walking/Swimming", sets: 1, reps: "45 min" }]},
      sun: { rest: true }
    };
  }
}

// ============================================================
// TIER BADGE SVG
// ============================================================
function tierBadge(level, sizePx = 64) {
  const s = sizePx;
  const uid = `${level}-${s}-${Math.random().toString(36).slice(2,7)}`;
  const badges = {
    1: `<svg viewBox="0 0 64 64" width="${s}" height="${s}">
      <defs><linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e8a26b"/><stop offset="100%" stop-color="#8b4513"/>
      </linearGradient></defs>
      <path d="M32 4 L52 12 L52 32 Q52 48 32 60 Q12 48 12 32 L12 12 Z" fill="url(#g${uid})" stroke="#5c2c0a" stroke-width="1.5"/>
      <circle cx="32" cy="28" r="9" fill="none" stroke="#fff" stroke-width="2.5" opacity="0.85"/>
      <circle cx="32" cy="28" r="3" fill="#fff" opacity="0.85"/>
      <g stroke="#fff" stroke-width="2.5" opacity="0.85">
        <line x1="32" y1="16" x2="32" y2="20"/><line x1="32" y1="36" x2="32" y2="40"/>
        <line x1="20" y1="28" x2="24" y2="28"/><line x1="40" y1="28" x2="44" y2="28"/>
      </g>
    </svg>`,
    2: `<svg viewBox="0 0 64 64" width="${s}" height="${s}">
      <defs><linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f1f5f9"/><stop offset="100%" stop-color="#64748b"/>
      </linearGradient></defs>
      <path d="M32 4 L52 12 L52 32 Q52 48 32 60 Q12 48 12 32 L12 12 Z" fill="url(#g${uid})" stroke="#475569" stroke-width="1.5"/>
      <path d="M22 22 L32 28 L42 22 M22 32 L32 38 L42 32 M22 42 L32 48 L42 42" fill="none" stroke="#fff" stroke-width="2.5" opacity="0.9"/>
    </svg>`,
    3: `<svg viewBox="0 0 64 64" width="${s}" height="${s}">
      <defs><linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#fde047"/><stop offset="100%" stop-color="#a16207"/>
      </linearGradient></defs>
      <path d="M32 4 L52 12 L52 32 Q52 48 32 60 Q12 48 12 32 L12 12 Z" fill="url(#g${uid})" stroke="#78350f" stroke-width="1.5"/>
      <path d="M12 18 Q4 22 6 30 L12 28 Z" fill="#fef3c7" opacity="0.9"/>
      <path d="M52 18 Q60 22 58 30 L52 28 Z" fill="#fef3c7" opacity="0.9"/>
      <circle cx="32" cy="32" r="11" fill="#fef3c7" opacity="0.95"/>
      <circle cx="24" cy="26" r="3" fill="#fef3c7"/>
      <circle cx="40" cy="26" r="3" fill="#fef3c7"/>
      <circle cx="28" cy="30" r="1.5" fill="#78350f"/>
      <circle cx="36" cy="30" r="1.5" fill="#78350f"/>
      <path d="M30 36 Q32 38 34 36" fill="none" stroke="#78350f" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    4: `<svg viewBox="0 0 64 64" width="${s}" height="${s}">
      <defs><linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#e879f9"/><stop offset="50%" stop-color="#a855f7"/><stop offset="100%" stop-color="#6b21a8"/>
      </linearGradient></defs>
      <path d="M12 30 Q4 28 4 36 L8 38 Q8 34 16 34 Z" fill="#c084fc" opacity="0.7"/>
      <path d="M52 30 Q60 28 60 36 L56 38 Q56 34 48 34 Z" fill="#c084fc" opacity="0.7"/>
      <path d="M32 8 L48 24 L40 50 L32 56 L24 50 L16 24 Z" fill="url(#g${uid})" stroke="#6b21a8" stroke-width="1.5"/>
      <path d="M32 8 L40 50 M32 8 L24 50 M16 24 L48 24" stroke="#fff" stroke-width="1" opacity="0.5"/>
      <path d="M28 14 L32 8 L36 14 Z" fill="#fff" opacity="0.4"/>
    </svg>`,
    5: `<svg viewBox="0 0 64 64" width="${s}" height="${s}">
      <defs><linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3a3a3a"/><stop offset="50%" stop-color="#1a1a1a"/><stop offset="100%" stop-color="#0a0a0a"/>
      </linearGradient></defs>
      <g fill="#2a1f3a" stroke="#3a2a52" stroke-width="0.5">
        <polygon points="32,4 36,12 28,12"/>
        <polygon points="56,12 56,20 50,16"/>
        <polygon points="8,12 8,20 14,16"/>
        <polygon points="60,52 52,52 56,46"/>
        <polygon points="4,52 12,52 8,46"/>
      </g>
      <path d="M32 10 L46 22 L40 50 L32 54 L24 50 L18 22 Z" fill="url(#g${uid})" stroke="#52437a" stroke-width="1.5"/>
      <path d="M32 10 L40 50 M32 10 L24 50 M18 22 L46 22" stroke="#a855f7" stroke-width="0.8" opacity="0.5"/>
      <path d="M28 16 L32 10 L36 16 Z" fill="#a855f7" opacity="0.5"/>
    </svg>`,
    6: `<svg viewBox="0 0 64 64" width="${s}" height="${s}">
      <defs>
        <linearGradient id="g${uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fff"/><stop offset="50%" stop-color="#bfdbfe"/><stop offset="100%" stop-color="#3b82f6"/>
        </linearGradient>
        <radialGradient id="gb${uid}"><stop offset="0%" stop-color="#fff" stop-opacity="0.8"/><stop offset="100%" stop-color="#fff" stop-opacity="0"/></radialGradient>
      </defs>
      <g fill="#e0e7ff" opacity="0.85">
        <path d="M12 32 Q0 24 0 38 Q6 40 12 36 Z"/>
        <path d="M14 36 Q4 34 4 44 Q10 44 16 40 Z"/>
        <path d="M52 32 Q64 24 64 38 Q58 40 52 36 Z"/>
        <path d="M50 36 Q60 34 60 44 Q54 44 48 40 Z"/>
      </g>
      <path d="M32 12 L46 26 L32 54 L18 26 Z" fill="url(#g${uid})" stroke="#1e40af" stroke-width="1.2"/>
      <path d="M18 26 L46 26 M32 12 L32 54 M22 20 L32 26 L42 20" stroke="#fff" stroke-width="1" opacity="0.7" fill="none"/>
      <circle cx="28" cy="22" r="3" fill="url(#gb${uid})"/>
      <g fill="#fff" opacity="0.9">
        <circle cx="10" cy="14" r="1"/><circle cx="54" cy="16" r="1.2"/>
        <circle cx="18" cy="50" r="1"/><circle cx="48" cy="52" r="1"/>
      </g>
    </svg>`
  };
  return badges[level] || badges[1];
}

// ============================================================
// GLOBAL STATE
// ============================================================
let currentUser = null;          // Firebase auth user
let userProfile = {};            // Cached user doc from Firestore
let workoutsCache = [];          // Last N workouts (live)
let allUsersCache = [];          // For leaderboard
let dietDoc = null;              // Current day's diet doc
let unit = localStorage.getItem("primelift-unit") || "kg";
let selectedLift = "bench";
let dietDateOffset = 0;
let authMode = "login";

let unsubUser = null;
let unsubWorkouts = null;
let unsubDiet = null;
let unsubAllUsers = null;

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

function toDisplayWeight(kg) { return unit === "kg" ? kg : kg * KG_TO_LB; }
function fromInputWeight(v)  { return unit === "kg" ? v  : v / KG_TO_LB; }
function formatWeight(kg) {
  const v = toDisplayWeight(kg || 0);
  return v % 1 === 0 ? v.toFixed(0) : v.toFixed(1);
}
function showToast(text, ms = 1800) {
  const t = $("toast"); t.textContent = text; t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), ms);
}
function dateKey(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}
function daysAgoLabel(date) {
  if (!date) return "—";
  const d = date.toDate ? date.toDate() : new Date(date);
  const now = new Date();
  const diff = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7)   return diff + "d ago";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ============================================================
// AUTH UI
// ============================================================
$$(".auth-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    authMode = btn.dataset.mode;
    $$(".auth-tab").forEach(b => b.classList.toggle("active", b === btn));
    $("auth-name").classList.toggle("active", authMode === "signup");
    $("auth-submit").textContent = authMode === "signup" ? "Create Account" : "Sign In";
    $("auth-error").textContent = "";
  });
});

$("auth-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const name = $("auth-name").value.trim();
  $("auth-error").textContent = "";
  $("auth-submit").textContent = "...";

  try {
    if (authMode === "signup") {
      if (!name) throw new Error("Pick a display name");
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), {
        displayName: name,
        email,
        createdAt: serverTimestamp(),
        prs: {},
        height: null, weight: null, age: null, sex: null,
        activity: null, goal: null,
        routine: null
      });
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    $("auth-error").textContent = friendlyAuthError(err);
    $("auth-submit").textContent = authMode === "signup" ? "Create Account" : "Sign In";
  }
});

function friendlyAuthError(err) {
  const code = err.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "Wrong email or password";
  if (code.includes("email-already-in-use")) return "Email already registered";
  if (code.includes("weak-password")) return "Password too weak (min 6 chars)";
  if (code.includes("invalid-email")) return "Invalid email";
  if (code.includes("network")) return "Network error — check connection";
  return err.message || "Something went wrong";
}

// ============================================================
// AUTH STATE
// ============================================================
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;

    // Ensure user doc exists
    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        displayName: user.displayName || user.email.split("@")[0],
        email: user.email,
        createdAt: serverTimestamp(),
        prs: {},
        height: null, weight: null, age: null, sex: null,
        activity: null, goal: null, routine: null
      });
    }

    // Live subscribe to user doc
    if (unsubUser) unsubUser();
    unsubUser = onSnapshot(userRef, (s) => {
      userProfile = s.exists() ? s.data() : {};
      updateProfileButton();
      renderTierBanner();
      renderPRs();
      // Re-render current page so it reflects new data
      const activePage = document.querySelector(".page.active")?.id;
      if (activePage === "page-rank")    renderRank();
      if (activePage === "page-routine") renderRoutine();
      if (activePage === "page-diet")    renderDiet();
      if (activePage === "page-profile") renderProfile();
    });

    subscribeWorkouts();
    subscribeAllUsers();
    loadDiet();

    $("auth").style.display = "none";
    $("app").classList.add("active");
    maybeShowInstallHint();
  } else {
    currentUser = null;
    userProfile = {};
    workoutsCache = [];
    if (unsubUser) unsubUser();
    if (unsubWorkouts) unsubWorkouts();
    if (unsubDiet) unsubDiet();
    if (unsubAllUsers) unsubAllUsers();
    $("auth").style.display = "flex";
    $("app").classList.remove("active");
    // Reset to home
    $$(".tab").forEach((b, i) => b.classList.toggle("active", i === 0));
    $$(".page").forEach(p => p.classList.toggle("active", p.id === "page-home"));
    // Reset auth form
    $("auth-submit").textContent = authMode === "signup" ? "Create Account" : "Sign In";
  }
});

function updateProfileButton() {
  const name = userProfile.displayName || "—";
  $("profile-btn-name").textContent = name;
  refreshAvatarDisplay();
}

function refreshAvatarDisplay() {
  const name = userProfile?.displayName || "—";
  const initial = name.charAt(0).toUpperCase();

  // Update initial text inside large avatar
  const initialEl = $("profile-avatar-initial");
  if (initialEl) initialEl.textContent = initial;

  const dataUrl = localStorage.getItem("primelift-avatar");

  // Large avatar — show photo or initial
  const imgEl = $("profile-avatar-img");
  if (imgEl) {
    if (dataUrl) {
      imgEl.src = dataUrl;
      imgEl.style.display = "block";
      if (initialEl) initialEl.style.display = "none";
    } else {
      imgEl.style.display = "none";
      if (initialEl) initialEl.style.display = "";
    }
  }

  // Small avatar in topbar — show photo or initial
  const sm = $("profile-avatar-sm");
  if (sm) {
    if (dataUrl) {
      sm.style.backgroundImage = `url('${dataUrl}')`;
      sm.style.backgroundSize = "cover";
      sm.style.backgroundPosition = "center";
      sm.textContent = "";
    } else {
      sm.style.backgroundImage = "";
      sm.textContent = initial;
    }
  }
}

// ============================================================
// TAB NAVIGATION
// ============================================================
$$(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    const page = btn.dataset.page;
    $$(".tab").forEach(b => b.classList.toggle("active", b === btn));
    $$(".page").forEach(p => p.classList.toggle("active", p.id === `page-${page}`));
    if (page === "home")    { renderTierBanner(); renderPRs(); renderRecent(); }
    if (page === "rank")    renderRank();
    if (page === "routine") renderRoutine();
    if (page === "diet")    renderDiet();
  });
});

// Profile button (in topbar)
$("profile-btn").addEventListener("click", () => {
  $$(".tab").forEach(b => b.classList.remove("active"));
  $$(".page").forEach(p => p.classList.toggle("active", p.id === "page-profile"));
  renderProfile();
});

$("profile-back").addEventListener("click", () => {
  $$(".page").forEach(p => p.classList.toggle("active", p.id === "page-home"));
  $$(".tab").forEach((b, i) => b.classList.toggle("active", i === 0));
  renderTierBanner();
  renderPRs();
});

$("profile-signout").addEventListener("click", () => signOut(auth));

// ============================================================
// AVATAR / PROFILE PICTURE
// ============================================================
$("profile-avatar-lg").addEventListener("click", () => $("avatar-file-input").click());

$("avatar-file-input").addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast("Image must be under 5 MB"); return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      // Resize to max 400px to keep localStorage small
      const MAX = 400;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
        else { width = Math.round(width * MAX / height); height = MAX; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL("image/jpeg", 0.82);
      try {
        localStorage.setItem("primelift-avatar", compressed);
      } catch {
        showToast("Storage full — try a smaller image");
        return;
      }
      refreshAvatarDisplay();
      showToast("Profile picture updated ✓");
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = ""; // allow re-selecting same file
});

$("profile-delete").addEventListener("click", async () => {
  if (!confirm("Delete your account? This permanently removes all lifts, diet logs, and PRs.")) return;
  if (!confirm("Are you absolutely sure? This cannot be undone.")) return;
  try {
    // Delete user doc and all subcollections
    const uid = currentUser.uid;
    const workoutsSnap = await getDocs(collection(db, "users", uid, "workouts"));
    for (const w of workoutsSnap.docs) await deleteDoc(w.ref);
    const dietSnap = await getDocs(collection(db, "users", uid, "diet"));
    for (const d of dietSnap.docs) await deleteDoc(d.ref);
    await deleteDoc(doc(db, "users", uid));
    await deleteUser(currentUser);
    showToast("Account deleted");
  } catch (err) {
    console.error(err);
    if (err.code === "auth/requires-recent-login") {
      showToast("Sign out and back in, then try again");
    } else {
      showToast("Delete failed: " + (err.message || "unknown"));
    }
  }
});

// ============================================================
// UNIT TOGGLE
// ============================================================
function setUnit(u) {
  unit = u;
  localStorage.setItem("primelift-unit", u);
  $("unit-kg").classList.toggle("active", u === "kg");
  $("unit-lb").classList.toggle("active", u === "lb");
  $("profile-unit-kg")?.classList.toggle("active", u === "kg");
  $("profile-unit-lb")?.classList.toggle("active", u === "lb");
  renderAll();
}
$("unit-kg").addEventListener("click", () => setUnit("kg"));
$("unit-lb").addEventListener("click", () => setUnit("lb"));
$("profile-unit-kg").addEventListener("click", () => setUnit("kg"));
$("profile-unit-lb").addEventListener("click", () => setUnit("lb"));
setUnit(unit);

// ============================================================
// LIFT SELECTOR
// ============================================================
function renderLiftSelect() {
  $("lift-select").innerHTML = LIFTS.map(l =>
    `<button class="lift-btn ${l.id === selectedLift ? "active" : ""}" data-lift="${l.id}">${l.name}</button>`
  ).join("");
  $$("#lift-select .lift-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedLift = btn.dataset.lift;
      renderLiftSelect();
      updateE1RM();
    });
  });
}
renderLiftSelect();

function updateE1RM() {
  const w = parseFloat($("log-weight").value);
  const r = parseInt($("log-reps").value);
  if (!w || !r) {
    $("e1rm-value").innerHTML = `— <span style="font-size:14px;color:var(--text-faint);">${unit}</span>`;
    $("e1rm-value").classList.remove("pr");
    return;
  }
  const wkg = fromInputWeight(w);
  const e1rm = calcE1RM(wkg, r);
  $("e1rm-value").innerHTML = `${formatWeight(e1rm)} <span style="font-size:14px;color:var(--text-faint);">${unit}</span>`;
  const prev = userProfile.prs?.[selectedLift]?.e1rm || 0;
  $("e1rm-value").classList.toggle("pr", e1rm > prev + 0.01);
}
$("log-weight").addEventListener("input", updateE1RM);
$("log-reps").addEventListener("input", updateE1RM);

// ============================================================
// LOG SUBMIT
// ============================================================
$("log-submit").addEventListener("click", async () => {
  const w = parseFloat($("log-weight").value);
  const r = parseInt($("log-reps").value);
  const s = parseInt($("log-sets").value) || 1;
  if (!w || w <= 0) return showToast("Enter a weight");
  if (!r || r < 1)  return showToast("Enter reps");

  const wkg = fromInputWeight(w);
  const e1rm = calcE1RM(wkg, r);

  try {
    $("log-submit").textContent = "...";
    await addDoc(collection(db, "users", currentUser.uid, "workouts"), {
      lift: selectedLift, weight: wkg, reps: r, sets: s, e1rm,
      date: serverTimestamp()
    });

    // Update PR if needed
    const prev = userProfile.prs?.[selectedLift]?.e1rm || 0;
    let isPR = false;
    if (e1rm > prev + 0.01) {
      isPR = true;
      const newPRs = { ...(userProfile.prs || {}), [selectedLift]: {
        weight: wkg, reps: r, e1rm, date: new Date().toISOString()
      }};
      await setDoc(doc(db, "users", currentUser.uid), { prs: newPRs }, { merge: true });
    }

    showToast(isPR ? "🔥 NEW PR!" : "Logged");
    $("log-weight").value = "";
    $("log-reps").value = "";
    $("log-sets").value = "1";
    updateE1RM();
  } catch (err) {
    console.error(err);
    showToast("Save failed");
  } finally {
    $("log-submit").textContent = "Log Set";
  }
});

// ============================================================
// WORKOUTS SUBSCRIPTION
// ============================================================
function subscribeWorkouts() {
  if (unsubWorkouts) unsubWorkouts();
  const q = query(
    collection(db, "users", currentUser.uid, "workouts"),
    orderBy("date", "desc"),
    limit(50)
  );
  unsubWorkouts = onSnapshot(q, (snap) => {
    workoutsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderRecent();
  });
}

async function recomputePR(liftId) {
  const q = query(
    collection(db, "users", currentUser.uid, "workouts"),
    orderBy("e1rm", "desc"),
    limit(20)
  );
  const snap = await getDocs(q);
  let best = null;
  snap.forEach(d => {
    const w = d.data();
    if (w.lift === liftId && (!best || w.e1rm > best.e1rm)) best = w;
  });
  const newPRs = { ...(userProfile.prs || {}) };
  if (best) {
    newPRs[liftId] = {
      weight: best.weight, reps: best.reps, e1rm: best.e1rm,
      date: best.date?.toDate?.()?.toISOString() || new Date().toISOString()
    };
  } else {
    delete newPRs[liftId];
  }
  await setDoc(doc(db, "users", currentUser.uid), { prs: newPRs }, { merge: true });
}

// ============================================================
// LEADERBOARD: subscribe to all users
// ============================================================
function subscribeAllUsers() {
  if (unsubAllUsers) unsubAllUsers();
  unsubAllUsers = onSnapshot(collection(db, "users"), (snap) => {
    allUsersCache = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    if (document.querySelector(".page.active")?.id === "page-rank") renderRank();
  });
}

// ============================================================
// HOME: tier banner + PRs + recent
// ============================================================
function renderTierBanner() {
  if (!userProfile.prs) return;
  const total = getTotalE1RM(userProfile.prs);
  const bw = userProfile.weight;
  const tier = getTier(total, bw);
  const next = getNextTier(tier.level, bw);

  $("tier-banner-icon").innerHTML = tierBadge(tier.level, 64);
  $("tier-banner-level").textContent = "LEVEL " + tier.level;
  $("tier-banner-name").textContent = tier.name;

  if (!bw) {
    $("tier-progress-fill").style.width = "0%";
    $("tier-progress-label").innerHTML = `<span style="color:var(--accent-light)">Set your bodyweight in Profile to rank up →</span>`;
    return;
  }
  if (next) {
    const span = next.minKg - tier.minKg;
    const have = total - tier.minKg;
    const pct = Math.min(100, Math.max(0, (have / span) * 100));
    setTimeout(() => { $("tier-progress-fill").style.width = pct + "%"; }, 100);
    $("tier-progress-label").textContent = `${formatWeight(total)} / ${formatWeight(next.minKg)} ${unit} → ${next.name}`;
  } else {
    $("tier-progress-fill").style.width = "100%";
    $("tier-progress-label").textContent = `MAX TIER • ${formatWeight(total)} ${unit}`;
  }
}

function renderPRs() {
  const prs = userProfile.prs || {};
  $("pr-grid").innerHTML = LIFTS.map(l => {
    const pr = prs[l.id];
    if (!pr) return `<div class="pr-card"><div class="pr-lift">${l.name}</div><div class="pr-value" style="color:var(--text-faint)">—</div><div class="pr-unit">no data yet</div></div>`;
    return `<div class="pr-card">
      <div class="pr-lift">${l.name}</div>
      <div class="pr-value">${formatWeight(pr.e1rm)}</div>
      <div class="pr-unit">${unit} • est 1RM</div>
      <div class="pr-meta">${formatWeight(pr.weight)} × ${pr.reps}</div>
    </div>`;
  }).join("");
}

function renderRecent() {
  const list = workoutsCache.slice(0, 10);
  if (!list.length) { $("recent-list").innerHTML = `<div class="empty">No lifts logged yet</div>`; return; }
  const prs = userProfile.prs || {};
  $("recent-list").innerHTML = list.map(w => {
    const liftName = LIFTS.find(l => l.id === w.lift)?.name || w.lift;
    const isPR = prs[w.lift]?.e1rm && Math.abs(prs[w.lift].e1rm - w.e1rm) < 0.01;
    return `<div class="history-item">
      <div>
        <span class="history-lift">${liftName}</span>${isPR ? '<span class="history-pr-badge">PR</span>' : ''}
        <div class="history-meta">${daysAgoLabel(w.date)} • ${w.sets || 1} set${(w.sets||1) > 1 ? 's' : ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <div>
          <div class="history-weight">${formatWeight(w.weight)} ${unit} × ${w.reps}</div>
          <div class="history-e1rm">e1RM ${formatWeight(w.e1rm)}</div>
        </div>
        <button class="delete-btn" data-id="${w.id}" data-lift="${w.lift}" title="Delete">✕</button>
      </div>
    </div>`;
  }).join("");
  $$("#recent-list .delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this lift?")) return;
      await deleteDoc(doc(db, "users", currentUser.uid, "workouts", btn.dataset.id));
      await recomputePR(btn.dataset.lift);
      showToast("Deleted");
    });
  });
}

// ============================================================
// RANK
// ============================================================
function renderRank() {
  if (!userProfile.prs) return;
  const total = getTotalE1RM(userProfile.prs);
  const bw = userProfile.weight;
  const tier = getTier(total, bw);
  const next = getNextTier(tier.level, bw);

  $("rank-hero-badge").innerHTML = tierBadge(tier.level, 110);
  $("rank-hero-level").textContent = "LEVEL " + tier.level;
  $("rank-hero-name").textContent = tier.name;

  const ratioStr = bw ? ` • ${(total / bw).toFixed(2)}× BW` : ` • Set bodyweight to rank`;
  $("rank-hero-total").innerHTML = `${formatWeight(total)} ${unit}<span style="font-family:var(--font-mono);font-size:11px;color:var(--text-faint);letter-spacing:1px;">${ratioStr}</span>`;

  if (!bw) {
    $("rank-progress-fill").style.width = "0%";
    $("rank-prog-curr").textContent = tier.name;
    $("rank-prog-next").textContent = "→ SET BW IN PROFILE";
    $("rank-prog-pct").textContent = "—";
    $("rank-prog-remaining").textContent = "BW NEEDED";
  } else if (next) {
    const span = next.minKg - tier.minKg;
    const have = total - tier.minKg;
    const pct = Math.min(100, Math.max(0, (have / span) * 100));
    setTimeout(() => { $("rank-progress-fill").style.width = pct + "%"; }, 100);
    $("rank-prog-curr").textContent = tier.name;
    $("rank-prog-next").textContent = "→ " + next.name;
    $("rank-prog-pct").textContent = pct.toFixed(0) + "%";
    $("rank-prog-remaining").textContent = formatWeight(Math.max(0, next.minKg - total)) + " " + unit + " TO GO";
  } else {
    $("rank-progress-fill").style.width = "100%";
    $("rank-prog-curr").textContent = "OLYMPIAN";
    $("rank-prog-next").textContent = "MAX TIER";
    $("rank-prog-pct").textContent = "100%";
    $("rank-prog-remaining").textContent = "—";
  }

  // Tier ladder
  const userRatio = bw ? total / bw : 0;
  $("tier-ladder").innerHTML = TIERS.map((t, i) => {
    const unlocked = bw && userRatio >= t.ratio;
    const isCurrent = t.level === tier.level && bw;
    const klass = isCurrent ? 'current' : (unlocked ? 'unlocked' : 'locked');
    const reqText = t.ratio === 0 ? "START" : `${t.ratio}× BW`;
    return `<div class="tier-pill ${klass}" style="animation-delay:${i * 0.05}s">
      ${tierBadge(t.level, 32)}
      <div class="tier-pill-name">${t.name}</div>
      <div class="tier-pill-req">${reqText}</div>
    </div>`;
  }).join("");

  // Leaderboard — sort by ratio
  const ranked = allUsersCache
    .map(u => {
      const t = getTotalE1RM(u.prs);
      return {
        uid: u.uid, name: u.displayName, total: t, weight: u.weight,
        tier: getTier(t, u.weight),
        ratio: u.weight ? t / u.weight : 0
      };
    })
    .filter(u => u.total > 0)
    .sort((a, b) => b.ratio - a.ratio);

  if (!ranked.length) {
    $("lb-list").innerHTML = `<div class="empty">No ranked lifters yet</div>`;
    return;
  }

  $("lb-list").innerHTML = ranked.map((u, i) => {
    const isMe = u.uid === currentUser.uid;
    const isGold = i === 0;
    const ratioStr = u.weight ? `${u.ratio.toFixed(2)}× BW` : "no BW";
    return `<div class="lb-row ${isGold ? 'gold' : ''} ${isMe ? 'me' : ''}" style="animation-delay:${i*0.06}s">
      <div class="lb-rank">${i + 1}</div>
      <div class="lb-badge">${tierBadge(u.tier.level, 36)}</div>
      <div>
        <div class="lb-name">${u.name || "Anonymous"}${isMe ? ' <span style="color:var(--accent);font-size:10px;font-family:var(--font-mono);letter-spacing:1px;">YOU</span>' : ''}</div>
        <div class="lb-tier">${u.tier.name} • ${ratioStr}</div>
      </div>
      <div>
        <div class="lb-total">${formatWeight(u.total)}</div>
        <div class="lb-total-unit">${unit} TOTAL</div>
      </div>
    </div>`;
  }).join("");
}

// ============================================================
// EXERCISE AUTOCOMPLETE DATABASE
// ============================================================
const EXERCISES = [
  // Chest
  "Bench Press","Incline Bench Press","Decline Bench Press",
  "Dumbbell Bench Press","Incline Dumbbell Press","Decline Dumbbell Press",
  "Cable Fly","Dumbbell Fly","Pec Deck","Push-Up","Dips",
  "Close Grip Bench Press","Chest Press Machine","Landmine Press",
  // Back
  "Deadlift","Rack Pull","Romanian Deadlift","Stiff-Leg Deadlift",
  "Barbell Row","Dumbbell Row","T-Bar Row","Seated Cable Row",
  "Lat Pulldown","Pull-Up","Chin-Up","Face Pulls",
  "Straight Arm Pulldown","Good Morning","Hyperextension",
  "Meadows Row","Chest-Supported Row","Pendlay Row",
  // Shoulders
  "Overhead Press","OHP","Barbell Overhead Press","Dumbbell Shoulder Press",
  "Arnold Press","Lateral Raises","Cable Lateral Raises","Front Raises",
  "Rear Delt Fly","Rear Delt Cable Fly","Upright Row",
  "Machine Shoulder Press","Behind-the-Neck Press","Cable Face Pulls","Cable Upright Row",
  // Legs
  "Squat","Front Squat","Hack Squat","Goblet Squat","Box Squat",
  "Bulgarian Split Squat","Split Squat","Walking Lunges","Reverse Lunges","Lateral Lunges",
  "Leg Press","Leg Curl","Seated Leg Curl","Leg Extension",
  "Calf Raises","Seated Calf Raises","Standing Calf Raises",
  "Hip Thrust","Glute Bridge","Cable Kickback",
  "Sumo Deadlift","Leg Abduction","Leg Adduction","Step-Up","Box Jump",
  // Arms
  "Barbell Curl","Dumbbell Curl","Hammer Curl","Preacher Curl",
  "Cable Curl","Concentration Curl","Incline Dumbbell Curl","Spider Curl",
  "Skull Crusher","Tricep Pushdown","Cable Pushdown","EZ Bar Curl",
  "Overhead Tricep Extension","Tricep Kickback","Diamond Push-Up",
  "Close-Grip Bench Press","JM Press","Reverse Curl",
  // Core
  "Plank","Side Plank","Crunches","Sit-Ups","Russian Twists",
  "Leg Raises","Hanging Leg Raises","Hanging Knee Raises",
  "Ab Wheel Rollout","Cable Crunch","Machine Crunch",
  "Hollow Hold","Dead Bug","Bird Dog","Mountain Climbers","V-Ups",
  "Dragon Flag","Pallof Press",
  // Cardio
  "Running","Treadmill Run","Incline Walk","Walking",
  "Cycling","Stationary Bike","Rowing Machine","Jump Rope",
  "Stair Climber","Elliptical","Swimming","HIIT Cardio",
  "Burpees","Box Jumps","Jump Squats","High Knees","Battle Ropes",
  // Olympic / Power
  "Power Clean","Clean and Jerk","Snatch","Push Jerk","Push Press",
  "Hang Clean","Hang Snatch","Overhead Squat",
];

// ============================================================
// ROUTINE — SWAP DAYS
// ============================================================
let _swapSource = null; // dayId string while in swap mode

function enterSwapMode(dayId) {
  _swapSource = dayId;
  document.getElementById(`day-${dayId}`)?.classList.add("swap-source");
  DAYS.forEach(d => {
    if (d.id === dayId) return;
    const card = document.getElementById(`day-${d.id}`);
    if (!card) return;
    const tBtn = document.createElement("button");
    tBtn.className = "swap-target-btn";
    tBtn.textContent = `⇄ Swap with ${d.name}`;
    tBtn.dataset.target = d.id;
    card.classList.add("swap-target-highlight");
    card.prepend(tBtn);
    tBtn.addEventListener("click", () => executeSwap(dayId, d.id));
  });
}

function exitSwapMode() {
  _swapSource = null;
  document.querySelectorAll(".swap-target-btn").forEach(b => b.remove());
  document.querySelectorAll(".swap-source,.swap-target-highlight")
    .forEach(el => { el.classList.remove("swap-source","swap-target-highlight"); });
}

async function executeSwap(dayA, dayB) {
  const routine = userProfile.routine || {};
  const newRoutine = { ...routine };
  const tmp = { ...(newRoutine[dayA] || { rest: true }) };
  newRoutine[dayA] = { ...(newRoutine[dayB] || { rest: true }) };
  newRoutine[dayB] = tmp;
  await setDoc(doc(db, "users", currentUser.uid), { routine: newRoutine }, { merge: true });
  showToast(`${dayA.toUpperCase()} ⇄ ${dayB.toUpperCase()} swapped ✓`);
  exitSwapMode();
}

// ============================================================
// ROUTINE — FULL MONTH CALENDAR
// ============================================================
function openFullCalendar(routine) {
  const existing = document.getElementById("cal-modal-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "cal-modal-overlay";
  overlay.className = "cal-modal-overlay";
  overlay.innerHTML = `
    <div class="cal-modal">
      <div class="cal-modal-nav">
        <button id="cal-prev">‹</button>
        <span id="cal-month-label" class="cal-month-label"></span>
        <button id="cal-next">›</button>
        <button id="cal-close-btn" class="cal-close-btn">✕</button>
      </div>
      <div class="cal-weekday-row">
        ${["MON","TUE","WED","THU","FRI","SAT","SUN"].map(d => `<span>${d}</span>`).join("")}
      </div>
      <div id="cal-grid" class="cal-grid"></div>
      <div class="cal-legend">
        <span class="cal-legend-item"><span class="cal-dot workout"></span> Workout</span>
        <span class="cal-legend-item"><span class="cal-dot rest"></span> Rest</span>
        <span class="cal-legend-item"><span class="cal-today-dot"></span> Today</span>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let viewDate = new Date();

  function renderCal(date) {
    const y = date.getFullYear();
    const m = date.getMonth();
    overlay.querySelector("#cal-month-label").textContent =
      date.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toUpperCase();

    const firstDay = new Date(y, m, 1);
    const lastDay  = new Date(y, m + 1, 0);
    const today    = new Date();
    const startDow = (firstDay.getDay() + 6) % 7; // Mon=0

    const grid = overlay.querySelector("#cal-grid");
    grid.innerHTML = "";

    for (let i = 0; i < startDow; i++) {
      grid.appendChild(Object.assign(document.createElement("div"), { className: "cal-cell empty" }));
    }
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const d = new Date(y, m, day);
      const dowIdx = (d.getDay() + 6) % 7;
      const dayId  = DAYS[dowIdx].id;
      const dayData = (routine || {})[dayId] || { rest: true };
      const isRest  = !!dayData.rest;
      const exCount = dayData.exercises?.length || 0;
      const isToday = d.toDateString() === today.toDateString();

      const cell = document.createElement("div");
      cell.className = `cal-cell${isToday ? " today" : ""}${isRest ? " rest" : " workout"}`;
      cell.innerHTML = `
        <span class="cal-cell-num">${day}</span>
        ${!isRest ? `<span class="cal-cell-ex">${exCount}ex</span>` : ""}
      `;
      cell.title = isRest ? `${DAYS[dowIdx].name.toUpperCase()} — Rest` :
        `${DAYS[dowIdx].name.toUpperCase()} — ${dayData.exercises?.map(e => e.name).join(", ") || ""}`;

      cell.addEventListener("click", () => {
        overlay.remove();
        const card = document.getElementById(`day-${dayId}`);
        if (card) { card.scrollIntoView({ behavior: "smooth", block: "center" }); }
      });
      grid.appendChild(cell);
    }
  }

  renderCal(viewDate);

  overlay.querySelector("#cal-prev").addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() - 1); renderCal(viewDate); });
  overlay.querySelector("#cal-next").addEventListener("click", () => { viewDate.setMonth(viewDate.getMonth() + 1); renderCal(viewDate); });
  overlay.querySelector("#cal-close-btn").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// ============================================================
// ROUTINE
// ============================================================
function renderRoutine() {
  const c = $("routine-content");
  if (!c) return;
  const bmi = getBMI(userProfile.height, userProfile.weight);

  if (bmi == null) {
    c.innerHTML = `
      <div class="bmi-gate">
        <div class="bmi-gate-title">SET UP YOUR PROFILE</div>
        <div class="bmi-gate-sub">Enter your height &amp; weight so we can<br/>recommend a routine that fits you.</div>
        <div class="form-row two-col" style="margin-bottom:12px">
          <div class="form-field">
            <span class="form-label">Height (cm)</span>
            <input id="bmi-h" class="number-input" type="number" inputmode="numeric" min="100" max="250" placeholder="175"/>
          </div>
          <div class="form-field">
            <span class="form-label">Weight (kg)</span>
            <input id="bmi-w" class="number-input" type="number" inputmode="decimal" min="30" max="300" step="0.1" placeholder="78"/>
          </div>
        </div>
        <button id="bmi-submit" class="btn">Calculate &amp; Continue</button>
      </div>
      <div class="info-text">
        <strong>Note:</strong> you can edit or replace any recommended routine after. BMI is just a starting point — it doesn't define you.
      </div>
    `;
    $("bmi-submit").addEventListener("click", async () => {
      const h = parseFloat($("bmi-h").value);
      const w = parseFloat($("bmi-w").value);
      if (!h || !w) return showToast("Fill both fields");
      const newRoutine = recommendedRoutine(getBMI(h, w));
      await setDoc(doc(db, "users", currentUser.uid), {
        height: h, weight: w, routine: newRoutine
      }, { merge: true });
      showToast("Routine generated");
    });
    return;
  }

  const cat = bmiCategory(bmi);
  const today = new Date();
  const dow = (today.getDay() + 6) % 7;
  const monday = new Date(today); monday.setDate(today.getDate() - dow);
  const weekDays = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    weekDays.push(d);
  }
  const fmtRange = `${weekDays[0].toLocaleDateString(undefined, {month:'short',day:'numeric'})} – ${weekDays[6].toLocaleDateString(undefined, {month:'short',day:'numeric'})}`.toUpperCase();
  const routine = userProfile.routine || recommendedRoutine(bmi);

  c.innerHTML = `
    <div class="bmi-stat">
      <div class="bmi-stat-item">
        <div class="bmi-stat-label">Height</div>
        <div class="bmi-stat-value">${userProfile.height} <span style="font-size:11px;color:var(--text-faint)">cm</span></div>
      </div>
      <div class="bmi-stat-item">
        <div class="bmi-stat-label">Weight</div>
        <div class="bmi-stat-value">${userProfile.weight} <span style="font-size:11px;color:var(--text-faint)">kg</span></div>
      </div>
      <div class="bmi-stat-item">
        <div class="bmi-stat-label">BMI</div>
        <div class="bmi-stat-value bmi-stat-cat">${bmi.toFixed(1)}</div>
        <div style="font-family:var(--font-mono);font-size:9px;color:var(--text-faint);letter-spacing:1px;margin-top:2px">${cat.toUpperCase()}</div>
      </div>
    </div>

    <div class="week-cal-wrap">
      <div class="week-cal-header" id="open-full-cal" style="cursor:pointer" title="Tap to view full month calendar">
        <span class="week-cal-title">This Week</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="week-cal-range">${fmtRange}</span>
          <span style="font-family:var(--font-mono);font-size:10px;color:var(--accent-light);letter-spacing:1px">📅 FULL MONTH</span>
        </div>
      </div>
      <div class="week-cal">
        ${weekDays.map((d, i) => {
          const dayId = DAYS[i].id;
          const day = (routine || {})[dayId] || { rest: true };
          const isToday = d.toDateString() === today.toDateString();
          const isRest = !!day.rest;
          return `<div class="week-cal-day ${isToday ? 'today' : ''} ${isRest ? 'rest' : ''}" data-day="${dayId}" style="animation-delay:${i*0.04}s">
            <div class="week-cal-dow">${DAYS[i].name}</div>
            <div class="week-cal-date">${d.getDate()}</div>
            <div class="week-cal-dot"></div>
          </div>`;
        }).join("")}
      </div>
    </div>

    <div class="info-text">
      <strong>Recommended for ${cat.toLowerCase()}.</strong> ${
        cat === 'Normal' ? 'Push / Pull / Legs split, 6 days/week.' :
        cat === 'Underweight' ? '4-day strength focus. Eat in surplus.' :
        cat === 'Overweight' ? '3 lifting days + 2 cardio.' :
        '3 low-impact days + walking. Build slowly.'
      } Tap a day on the calendar to jump to it.
    </div>

    ${DAYS.map((d, i) => {
      const day = (routine || {})[d.id] || { rest: true };
      const isToday = weekDays[i].toDateString() === today.toDateString();
      const todayBadge = isToday ? ' <span style="font-family:var(--font-mono);font-size:10px;color:var(--accent-light);letter-spacing:1px;background:rgba(168,85,247,0.15);padding:2px 6px;border-radius:3px;margin-left:6px;vertical-align:2px;">TODAY</span>' : '';
      if (day.rest) {
        return `<div id="day-${d.id}" class="day-card rest" style="animation-delay:${i*0.05}s">
          <div class="day-card-header">
            <div class="day-name">${d.name}${todayBadge}</div>
            <div style="display:flex;align-items:center;gap:6px">
              <div class="day-tag">REST DAY</div>
              <button class="day-swap-btn" data-day="${d.id}" title="Swap with another day">⇄</button>
              <button class="day-edit-btn" data-day="${d.id}">✎ Edit</button>
            </div>
          </div>
          ${day.note ? `<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-faint);letter-spacing:0.5px">${day.note}</div>` : ''}
        </div>`;
      }
      return `<div id="day-${d.id}" class="day-card" style="animation-delay:${i*0.05}s">
        <div class="day-card-header">
          <div class="day-name">${d.name}${todayBadge}</div>
          <div style="display:flex;align-items:center;gap:6px">
            <div class="day-tag">${day.exercises.length} EXERCISES</div>
            <button class="day-swap-btn" data-day="${d.id}" title="Swap with another day">⇄</button>
            <button class="day-edit-btn" data-day="${d.id}">✎ Edit</button>
          </div>
        </div>
        ${day.exercises.map(ex => `<div class="day-exercise">
          <span class="day-ex-name">${ex.name}</span>
          <span class="day-ex-sr">${ex.sets} × ${ex.reps}</span>
        </div>`).join("")}
      </div>`;
    }).join("")}

    <button id="routine-regen" class="btn" style="margin-top:16px;background:var(--bg-card);border:1px solid var(--border)">Regenerate Routine</button>
  `;

  $$(".week-cal-day").forEach(el => {
    el.addEventListener("click", () => {
      const target = document.getElementById("day-" + el.dataset.day);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });

  $("open-full-cal")?.addEventListener("click", () => openFullCalendar(routine));

  $$(".day-edit-btn").forEach(btn => {
    btn.addEventListener("click", () => openDayEditor(btn.dataset.day, routine));
  });

  $$(".day-swap-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (_swapSource) { exitSwapMode(); return; }
      enterSwapMode(btn.dataset.day);
    });
  });

  $("routine-regen")?.addEventListener("click", async () => {
    if (!confirm("Regenerate routine based on current BMI? This replaces your current routine.")) return;
    const newRoutine = recommendedRoutine(bmi);
    await setDoc(doc(db, "users", currentUser.uid), { routine: newRoutine }, { merge: true });
    showToast("Routine regenerated");
  });
}

// ============================================================
// EXERCISE AUTOCOMPLETE
// ============================================================
function attachExerciseAutocomplete(input) {
  const wrap = input.closest(".ex-name-wrap");
  if (!wrap) return;
  let list = wrap.querySelector(".ex-suggestions");
  if (!list) {
    list = document.createElement("div");
    list.className = "ex-suggestions";
    wrap.appendChild(list);
  }

  let activeIdx = -1;

  function showSuggestions(q) {
    if (!q) { list.style.display = "none"; return; }
    const matches = EXERCISES.filter(e => e.toLowerCase().startsWith(q.toLowerCase())).slice(0, 8);
    if (!matches.length) { list.style.display = "none"; return; }
    activeIdx = -1;
    list.innerHTML = matches.map((m, i) =>
      `<div class="ex-sug-item" data-idx="${i}">${m}</div>`
    ).join("");
    list.style.display = "block";
    list.querySelectorAll(".ex-sug-item").forEach(item => {
      item.addEventListener("mousedown", (e) => { // mousedown fires before blur
        e.preventDefault();
        input.value = item.textContent;
        list.style.display = "none";
        activeIdx = -1;
        input.focus();
      });
    });
  }

  input.addEventListener("input", () => showSuggestions(input.value.trim()));
  input.addEventListener("focus", () => { if (input.value.trim()) showSuggestions(input.value.trim()); });
  input.addEventListener("blur", () => setTimeout(() => { list.style.display = "none"; }, 150));

  input.addEventListener("keydown", (e) => {
    const items = list.querySelectorAll(".ex-sug-item");
    if (!items.length || list.style.display === "none") return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      input.value = items[activeIdx].textContent;
      list.style.display = "none";
      activeIdx = -1;
      return;
    } else if (e.key === "Escape") {
      list.style.display = "none";
      return;
    }
    items.forEach((it, i) => it.classList.toggle("active", i === activeIdx));
    if (activeIdx >= 0) items[activeIdx].scrollIntoView({ block: "nearest" });
  });
}

// ============================================================
// DAY EDITOR — inline editor for a single day card
// ============================================================
function openDayEditor(dayId, routine) {
  const day = (routine || {})[dayId] || { rest: true };
  const card = document.getElementById(`day-${dayId}`);
  if (!card) return;

  const dayInfo = DAYS.find(d => d.id === dayId);
  const today = new Date();
  const dow = (today.getDay() + 6) % 7;
  const monday = new Date(today); monday.setDate(today.getDate() - dow);
  const dayIdx = DAYS.findIndex(d => d.id === dayId);
  const dayDate = new Date(monday); dayDate.setDate(monday.getDate() + dayIdx);
  const isToday = dayDate.toDateString() === today.toDateString();
  const todayBadge = isToday
    ? ' <span style="font-family:var(--font-mono);font-size:10px;color:var(--accent-light);letter-spacing:1px;background:rgba(168,85,247,0.15);padding:2px 6px;border-radius:3px;margin-left:6px;vertical-align:2px;">TODAY</span>'
    : '';

  let editIsRest = !!day.rest;
  const exList = editIsRest ? [] : (day.exercises || []);

  function exRowHTML(ex, i) {
    return `<div class="ex-edit-row" data-idx="${i}">
      <div class="ex-name-wrap">
        <input class="ex-name-input" type="text" value="${ex.name || ''}" placeholder="Exercise name" autocomplete="off" />
        <div class="ex-suggestions" style="display:none"></div>
      </div>
      <div class="ex-sr-inputs">
        <input class="ex-sets-input" type="number" value="${ex.sets || 3}" min="1" max="20" placeholder="Sets" />
        <span class="ex-sr-sep">×</span>
        <input class="ex-reps-input" type="text" value="${ex.reps || '10'}" placeholder="Reps" />
      </div>
      <button class="ex-delete-btn" title="Remove exercise">✕</button>
    </div>`;
  }

  card.classList.remove("rest");
  card.innerHTML = `
    <div class="day-card-header" style="margin-bottom:12px">
      <div class="day-name">${dayInfo.name}${todayBadge}</div>
      <span class="day-tag" style="color:var(--accent-light);border-color:var(--accent-dim)">EDITING</span>
    </div>

    <button id="toggle-rest-${dayId}" class="toggle-rest-btn ${editIsRest ? '' : 'is-workout'}">
      ${editIsRest ? '＋ Add workout' : '💤 Set as rest day'}
    </button>

    <div id="ex-edit-list-${dayId}" class="ex-edit-list" ${editIsRest ? 'style="display:none"' : ''}>
      ${exList.map((ex, i) => exRowHTML(ex, i)).join("")}
    </div>

    <div id="rest-note-area-${dayId}" ${!editIsRest ? 'style="display:none"' : ''}>
      <input class="number-input" type="text" id="rest-note-${dayId}"
             placeholder="Optional note (e.g. Active recovery — walk)"
             value="${day.note || ''}"
             style="font-size:13px;margin-top:6px;width:100%" />
    </div>

    <button id="add-ex-btn-${dayId}" class="add-ex-btn" ${editIsRest ? 'style="display:none"' : ''}>＋ Add Exercise</button>

    <div class="day-editor-actions">
      <button id="save-day-${dayId}" class="btn" style="flex:1;min-width:0">Save</button>
      <button id="cancel-day-${dayId}" class="btn" style="flex:1;min-width:0;background:var(--bg-card);border:1px solid var(--border)">Cancel</button>
    </div>
  `;

  // Toggle rest/workout
  document.getElementById(`toggle-rest-${dayId}`).addEventListener("click", () => {
    editIsRest = !editIsRest;
    const btn = document.getElementById(`toggle-rest-${dayId}`);
    btn.textContent = editIsRest ? '＋ Add workout' : '💤 Set as rest day';
    btn.classList.toggle("is-workout", !editIsRest);
    document.getElementById(`ex-edit-list-${dayId}`).style.display = editIsRest ? "none" : "";
    document.getElementById(`rest-note-area-${dayId}`).style.display = editIsRest ? "" : "none";
    document.getElementById(`add-ex-btn-${dayId}`).style.display = editIsRest ? "none" : "";
  });

  // Attach autocomplete to existing exercise inputs
  document.getElementById(`ex-edit-list-${dayId}`).querySelectorAll(".ex-name-input").forEach(attachExerciseAutocomplete);

  // Delete existing exercise rows
  document.getElementById(`ex-edit-list-${dayId}`).querySelectorAll(".ex-delete-btn").forEach(btn => {
    btn.addEventListener("click", () => btn.closest(".ex-edit-row").remove());
  });

  // Add new exercise row
  document.getElementById(`add-ex-btn-${dayId}`).addEventListener("click", () => {
    const list = document.getElementById(`ex-edit-list-${dayId}`);
    const newIdx = list.querySelectorAll(".ex-edit-row").length;
    const div = document.createElement("div");
    div.className = "ex-edit-row";
    div.dataset.idx = newIdx;
    div.innerHTML = `
      <div class="ex-name-wrap">
        <input class="ex-name-input" type="text" value="" placeholder="Exercise name" autocomplete="off" />
        <div class="ex-suggestions" style="display:none"></div>
      </div>
      <div class="ex-sr-inputs">
        <input class="ex-sets-input" type="number" value="3" min="1" max="20" placeholder="Sets" />
        <span class="ex-sr-sep">×</span>
        <input class="ex-reps-input" type="text" value="10" placeholder="Reps" />
      </div>
      <button class="ex-delete-btn" title="Remove exercise">✕</button>
    `;
    div.querySelector(".ex-delete-btn").addEventListener("click", () => div.remove());
    attachExerciseAutocomplete(div.querySelector(".ex-name-input"));
    list.appendChild(div);
    div.querySelector(".ex-name-input").focus();
  });

  // Cancel — re-render the routine (restores view mode)
  document.getElementById(`cancel-day-${dayId}`).addEventListener("click", () => renderRoutine());

  // Save
  document.getElementById(`save-day-${dayId}`).addEventListener("click", async () => {
    // Always read the freshest routine so we don't overwrite concurrent changes
    const bmi = getBMI(userProfile.height, userProfile.weight);
    const freshRoutine = userProfile.routine || recommendedRoutine(bmi) || {};
    const newRoutine = { ...freshRoutine };

    // Derive mode from DOM state — never trust the closure variable
    const exListEl = document.getElementById(`ex-edit-list-${dayId}`);
    const saveAsRest = !exListEl || exListEl.style.display === "none";

    if (saveAsRest) {
      const noteEl = document.getElementById(`rest-note-${dayId}`);
      const note = noteEl ? noteEl.value.trim() : "";
      newRoutine[dayId] = { rest: true, ...(note ? { note } : {}) };
    } else {
      const rows = exListEl.querySelectorAll(".ex-edit-row");
      const exercises = [];
      rows.forEach(row => {
        const name = row.querySelector(".ex-name-input").value.trim();
        const sets = parseInt(row.querySelector(".ex-sets-input").value) || 3;
        const reps = row.querySelector(".ex-reps-input").value.trim() || "10";
        if (name) exercises.push({ name, sets, reps });
      });
      if (!exercises.length) { showToast("Add at least one exercise"); return; }
      newRoutine[dayId] = { exercises };
    }

    const saveBtn = document.getElementById(`save-day-${dayId}`);
    saveBtn.textContent = "Saving…";
    saveBtn.disabled = true;
    try {
      await setDoc(doc(db, "users", currentUser.uid), { routine: newRoutine }, { merge: true });
      userProfile.routine = newRoutine; // update local copy immediately
      showToast("Day saved ✓");
      renderRoutine(); // explicit re-render — don't wait for onSnapshot
    } catch (err) {
      console.error("Save error:", err);
      showToast("Save failed: " + err.message);
      saveBtn.textContent = "Save";
      saveBtn.disabled = false;
    }
  });
}

// ============================================================
// BUDGET MEAL PLAN ENGINE
// ============================================================
function generateBudgetPlan(weeklyBudget) {
  const shopping = [];
  const boughtP = []; // protein ids
  const boughtV = []; // veg ids
  const boughtC = ["bigas"]; // carb ids (rice always included)

  // Pantry (fixed cooking essentials)
  const pantryItems = weeklyBudget >= 350 ? PH_PANTRY_FULL : PH_PANTRY_BASIC;
  const pantryTotal  = pantryItems.reduce((s, i) => s + i.cost, 0);

  // Rice (always buy; 2kg if budget allows)
  const rice    = PH_MARKET.carbs.find(c => c.id === "bigas");
  const riceQty = weeklyBudget >= 700 ? 2 : 1;
  shopping.push({ ...rice, qty: riceQty, totalCost: rice.cost * riceQty,
    label: `${riceQty}kg`, totalSv: rice.sv * riceQty, cat: "Carbs" });

  let rem = Math.max(0, weeklyBudget - pantryTotal - rice.cost * riceQty);
  const pBudget = rem * 0.58;
  const vBudget = rem * 0.24;
  const eBudget = rem * 0.18;

  // --- Proteins: rank by protein-per-peso (highest first) ---
  const rankedP = [...PH_MARKET.proteins].sort((a, b) =>
    (b.p / (b.cost / b.sv)) - (a.p / (a.cost / a.sv))
  );
  let pSpent = 0;
  for (const food of rankedP) {
    if (pSpent >= pBudget) break;
    const slack = pBudget - pSpent;
    if (food.cost > slack + 15) continue;
    let qty = 1;
    if (food.id === "egg"     && slack >= food.cost * 1.85) qty = 2;
    if (food.id === "sardinas")
      qty = Math.min(3, Math.max(1, Math.floor(slack * 0.45 / food.cost)));
    if (food.id === "monggo"  && slack >= food.cost * 2)    qty = 2;
    if (food.cost * qty > slack + 12) qty = 1;
    if (food.cost > slack + 12) continue;
    shopping.push({ ...food, qty, totalCost: food.cost * qty,
      label: `${qty} ${food.buy}`, totalSv: food.sv * qty, cat: "Protein" });
    pSpent += food.cost * qty;
    boughtP.push(food.id);
  }

  // --- Vegetables (variety: up to 4 types) ---
  let vSpent = 0;
  const maxV = weeklyBudget >= 500 ? 4 : 3;
  for (const veg of PH_MARKET.vegs) {
    if (boughtV.length >= maxV) break;
    if (veg.cost > vBudget - vSpent + 10) continue;
    shopping.push({ ...veg, qty: 1, totalCost: veg.cost,
      label: `1 ${veg.buy}`, totalSv: veg.sv, cat: "Vegetables" });
    vSpent += veg.cost;
    boughtV.push(veg.id);
  }

  // --- Extra carbs (if budget allows, buy 1 type) ---
  let eSpent = 0;
  for (const carb of PH_MARKET.carbs.filter(c => c.id !== "bigas")) {
    if (carb.cost > eBudget - eSpent + 10) continue;
    shopping.push({ ...carb, qty: 1, totalCost: carb.cost,
      label: `1 ${carb.buy}`, totalSv: carb.sv, cat: "Carbs" });
    boughtC.push(carb.id);
    break;
  }

  const totalSpent = pantryTotal + shopping.reduce((s, i) => s + i.totalCost, 0);
  const mealPlan   = buildPhWeekPlan(boughtP, boughtV, boughtC);
  const dailyAvg   = calcPhDailyAvg(mealPlan);

  return { shopping, pantryItems, pantryTotal, totalSpent, weeklyBudget, mealPlan, dailyAvg, boughtP, boughtV };
}

function buildPhWeekPlan(proteins, vegs, carbs) {
  const DAYS_PH = ["Lunes","Martes","Miyerkules","Huwebes","Biyernes","Sabado","Linggo"];
  const filter  = (list) => list.filter(m =>
    proteins.includes(m.p) &&
    carbs.includes(m.c) &&
    (!m.v || vegs.includes(m.v))
  );

  const fallback = { p:"egg", c:"bigas", v:null,
    name:"Itlog at Kanin", sub:"Fried egg + steamed rice" };
  const bOpts = filter(PH_MEAL_TEMPLATES.B);
  const lOpts = filter(PH_MEAL_TEMPLATES.L);
  const dOpts = filter(PH_MEAL_TEMPLATES.D);

  return DAYS_PH.map((day, i) => ({
    day,
    B: bOpts.length ? bOpts[i % bOpts.length] : fallback,
    L: lOpts.length ? lOpts[i % lOpts.length] : fallback,
    D: dOpts.length ? dOpts[i % dOpts.length] : fallback,
  }));
}

function calcPhDailyAvg(mealPlan) {
  const lu = (cat, id) => {
    if (!id) return { cal:8, p:1, c:1, f:0 };
    const src = cat === 'p' ? PH_MARKET.proteins
              : cat === 'v' ? PH_MARKET.vegs
              : PH_MARKET.carbs;
    return src.find(x => x.id === id) || { cal:0, p:0, c:0, f:0 };
  };
  let tCal=0, tP=0, tC=0, tF=0;
  for (const day of mealPlan) {
    for (const [slot, m] of Object.entries({ B: day.B, L: day.L, D: day.D })) {
      const pf = lu('p', m.p);
      const cf = lu('c', m.c);
      const vf = lu('v', m.v);
      const riceMulti = m.c === "bigas" ? (slot === "L" ? 2 : 1) : 1;
      tCal += pf.cal + cf.cal * riceMulti + vf.cal;
      tP   += pf.p   + cf.p   * riceMulti + vf.p;
      tC   += pf.c   + cf.c   * riceMulti + vf.c;
      tF   += pf.f   + cf.f   * riceMulti + vf.f;
    }
  }
  const d = mealPlan.length || 1;
  return { cal: Math.round(tCal/d), p: Math.round(tP/d), c: Math.round(tC/d), f: Math.round(tF/d) };
}

function renderBudgetResults(plan) {
  const r = $("bp-results");
  if (!r) return;

  const catIcon = { "Protein":"🥩", "Carbs":"🌾", "Vegetables":"🥬" };
  const grouped = {};
  for (const item of plan.shopping) {
    if (!grouped[item.cat]) grouped[item.cat] = [];
    grouped[item.cat].push(item);
  }

  const shopHTML = [
    `<div class="bp-shop-cat"><div class="bp-shop-cat-title">🧂 Pantry Essentials</div>
     ${plan.pantryItems.map(i => `
       <div class="bp-shop-row">
         <span class="bp-shop-name">${i.name}</span>
         <span class="bp-shop-qty">1×</span>
         <span class="bp-shop-price">₱${i.cost}</span>
       </div>`).join("")}
     </div>`
  ];
  for (const [cat, items] of Object.entries(grouped)) {
    shopHTML.push(`
      <div class="bp-shop-cat">
        <div class="bp-shop-cat-title">${catIcon[cat] || ""} ${cat}</div>
        ${items.map(i => `
          <div class="bp-shop-row">
            <span class="bp-shop-name">${i.name}</span>
            <span class="bp-shop-qty">${i.label}</span>
            <span class="bp-shop-price">₱${i.totalCost}</span>
          </div>`).join("")}
      </div>`);
  }

  const dayHTML = plan.mealPlan.map(day => `
    <div class="bp-day-card">
      <div class="bp-day-header">${day.day.toUpperCase()}</div>
      ${[["B","☀️ Agahan (Breakfast)"], ["L","🌤 Tanghalian (Lunch)"], ["D","🌙 Hapunan (Dinner)"]].map(([k, label]) => `
        <div class="bp-meal-slot">
          <div class="bp-meal-label">${label}</div>
          <div class="bp-meal-name">${day[k].name}</div>
          <div class="bp-meal-sub">${day[k].sub}</div>
        </div>`).join("")}
    </div>`).join("");

  const isOver   = plan.totalSpent > plan.weeklyBudget;
  const overAmt  = plan.totalSpent - plan.weeklyBudget;
  const budgetBar = Math.min(100, (plan.totalSpent / plan.weeklyBudget) * 100).toFixed(0);

  r.innerHTML = `
    <div class="bp-budget-bar-wrap">
      <div class="bp-budget-bar-track">
        <div class="bp-budget-bar-fill ${isOver ? 'over' : ''}" style="width:${budgetBar}%"></div>
      </div>
      <div class="bp-budget-bar-label">
        <span>₱${plan.totalSpent} spent</span>
        <span class="${isOver ? 'bp-over' : 'bp-ok'}">${isOver ? `₱${overAmt} over budget` : `₱${plan.weeklyBudget - plan.totalSpent} under budget ✓`}</span>
      </div>
    </div>

    <div class="bp-nutrition-summary">
      <div class="bp-nutr-title">Est. Daily Average (from this plan)</div>
      <div class="bp-nutr-grid">
        <div class="bp-nutr-item"><span class="bp-nutr-val">${plan.dailyAvg.cal}</span><span class="bp-nutr-key">kcal</span></div>
        <div class="bp-nutr-item"><span class="bp-nutr-val">${plan.dailyAvg.p}g</span><span class="bp-nutr-key">protein</span></div>
        <div class="bp-nutr-item"><span class="bp-nutr-val">${plan.dailyAvg.c}g</span><span class="bp-nutr-key">carbs</span></div>
        <div class="bp-nutr-item"><span class="bp-nutr-val">${plan.dailyAvg.f}g</span><span class="bp-nutr-key">fat</span></div>
      </div>
    </div>

    <div class="bp-section-title">🛒 SHOPPING LIST (palengke)</div>
    <div class="bp-shopping">${shopHTML.join("")}</div>

    <div class="bp-section-title">📅 7-DAY MEAL PLAN</div>
    <div class="bp-week">${dayHTML}</div>

    <div class="info-text" style="margin-top:12px">
      💡 <strong>Tips:</strong> Shop at your local palengke (wet market) for the lowest prices — typically 20–40% cheaper than supermarkets. Malunggay (moringa) is one of the most nutritious and cheapest vegetables available. Monggo is excellent budget protein. Buy rice in bulk when possible. Prices vary by region and season.
    </div>
  `;
}

// ============================================================
// PHOTO MEAL TRACKER — image resize + Netlify Function call
// ============================================================
function resizeImageForUpload(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX = 1024;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          if (width > height) { height = Math.round(height * MAX / width); width = MAX; }
          else { width = Math.round(width * MAX / height); height = MAX; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.88).split(",")[1]);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function analyzePhotoWithAI(base64) {
  const res = await fetch("/api/analyze-meal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: base64, mimeType: "image/jpeg" }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Show actual API error so we can diagnose
    const detail = payload.detail ? String(payload.detail).slice(0, 200) : "";
    throw new Error((payload.error || `HTTP ${res.status}`) + (detail ? " — " + detail : ""));
  }
  return payload;
}

// ============================================================
// DIET
// ============================================================
function updateDietLabel() {
  $("diet-date").textContent = dietDateOffset === 0 ? "TODAY" :
    dietDateOffset === -1 ? "YESTERDAY" : (Math.abs(dietDateOffset) + " DAYS AGO");
  $("diet-next").style.visibility = dietDateOffset >= 0 ? "hidden" : "visible";
}

function loadDiet() {
  if (unsubDiet) unsubDiet();
  updateDietLabel();
  const dk = dateKey(dietDateOffset);
  const ref = doc(db, "users", currentUser.uid, "diet", dk);
  unsubDiet = onSnapshot(ref, (snap) => {
    dietDoc = snap.exists() ? snap.data() : { calories: 0, protein: 0, carbs: 0, fats: 0 };
    if (document.querySelector(".page.active")?.id === "page-diet") renderDiet();
  });
}

function renderDiet() {
  updateDietLabel();
  const c = $("diet-content");
  if (!c) return;
  const d = dietDoc || { calories: 0, protein: 0, carbs: 0, fats: 0 };

  const profileReady = userProfile.weight && userProfile.height && userProfile.age && userProfile.sex && userProfile.activity && userProfile.goal;

  if (!profileReady) {
    renderDietGate(c);
    return;
  }

  const t = calcMacroTargets(userProfile.weight, userProfile.height, userProfile.age, userProfile.sex, userProfile.activity, userProfile.goal);
  const goal = GOALS.find(g => g.id === userProfile.goal);

  const pct = (cur, tgt) => Math.min(110, Math.max(0, (cur / tgt) * 100));
  const status = (cur, tgt) => {
    if (cur >= tgt * 1.05) return "over";
    if (cur >= tgt * 0.95) return "met";
    return "";
  };

  const need = {
    calories: Math.max(0, t.calories - d.calories),
    protein:  Math.max(0, t.protein  - d.protein),
    carbs:    Math.max(0, t.carbs    - d.carbs),
    fats:     Math.max(0, t.fats     - d.fats)
  };

  c.innerHTML = `
    <div class="diet-targets-card">
      <div class="diet-targets-header">
        <div class="diet-goal-pill">${goal.name} • ${goal.label}</div>
        <div class="diet-tdee-info">TDEE ${t.tdee} kcal</div>
      </div>
      ${macroBar("Calories", d.calories, t.calories, "kcal", "cals", pct, status)}
      ${macroBar("Protein",  d.protein,  t.protein,  "g",    "protein", pct, status)}
      ${macroBar("Carbs",    d.carbs,    t.carbs,    "g",    "carbs", pct, status)}
      ${macroBar("Fats",     d.fats,     t.fats,     "g",    "fats", pct, status)}
    </div>

    <div class="card">
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px">Quick Add</div>
      <div class="quick-add-grid" id="quick-add-grid">
        ${QUICK_MEALS.map((m, i) => `<button class="quick-add-btn" data-idx="${i}">
          ${m.name}
          <span class="qa-vals">${m.cals}cal • ${m.p}p ${m.c}c ${m.f}f</span>
        </button>`).join("")}
      </div>

      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:6px;margin-top:6px">Custom Entry</div>
      <div class="form-row" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        <div class="form-field">
          <span class="form-label" style="font-size:9px">Cals</span>
          <input id="add-cals" class="number-input" type="number" inputmode="numeric" min="0" placeholder="0" style="font-size:16px;padding:10px 4px" />
        </div>
        <div class="form-field">
          <span class="form-label" style="font-size:9px">Prot</span>
          <input id="add-protein" class="number-input" type="number" inputmode="numeric" min="0" placeholder="0" style="font-size:16px;padding:10px 4px" />
        </div>
        <div class="form-field">
          <span class="form-label" style="font-size:9px">Carb</span>
          <input id="add-carbs" class="number-input" type="number" inputmode="numeric" min="0" placeholder="0" style="font-size:16px;padding:10px 4px" />
        </div>
        <div class="form-field">
          <span class="form-label" style="font-size:9px">Fat</span>
          <input id="add-fats" class="number-input" type="number" inputmode="numeric" min="0" placeholder="0" style="font-size:16px;padding:10px 4px" />
        </div>
      </div>
      <button id="diet-add" class="btn" style="margin-top:8px">Add to Today</button>
      <button id="diet-reset" class="btn" style="margin-top:8px;background:var(--bg-elev);border:1px solid var(--border);font-size:13px;padding:10px">Reset Today's Log</button>
    </div>

    <div class="food-recs">
      ${renderFoodRecs(need, d, t)}
    </div>

    <div class="info-text" style="margin-top:10px">
      <strong>How this is calculated:</strong> Mifflin-St Jeor BMR formula → multiplied by activity factor for TDEE → adjusted by ${goal.calOffset > 0 ? "+" : ""}${goal.calOffset}kcal for ${goal.name.toLowerCase()}. Protein at ${goal.proteinPerKg}g/kg bodyweight (research-backed for trained lifters). Fat at ${(goal.fatPct*100)|0}% of calories. Carbs fill the remainder.
    </div>

    <!-- ======== AI PHOTO LOG ======== -->
    <div class="card photo-diet-card">
      <div class="pd-header">
        <span class="pd-title">📸 AI PHOTO LOG</span>
        <span class="pd-badge">BETA</span>
      </div>
      <div class="pd-sub">Snap your meal — Claude AI estimates the nutrition in seconds. Works best with clearly plated food.</div>
      <button id="photo-log-btn" class="btn" style="margin-top:10px">📷 Log Meal with Photo</button>
      <input type="file" id="photo-file-input" accept="image/*" style="display:none">
      <div id="photo-panel" style="display:none;margin-top:12px"></div>
    </div>

    <!-- ======== BUDGET MEAL PLAN ======== -->
    <div class="card budget-planner-card">
      <div class="bp-title">₱ BUDGET MEAL PLAN</div>
      <div class="bp-subtitle">Philippine palengke prices (2024–2025) • 7-day plan within your budget</div>
      <div class="bp-input-row">
        <div class="form-label" style="margin-bottom:6px">Lingguhang Badyet (Weekly Budget)</div>
        <div class="bp-input-wrap">
          <span class="bp-peso-sign">₱</span>
          <input id="bp-amount" class="number-input" type="number" inputmode="numeric"
                 min="200" max="5000" step="50" placeholder="400"
                 style="border-radius:0 6px 6px 0;border-left:none;padding-left:4px" />
        </div>
        <div class="bp-hint">Min ₱200 recommended. Based on Metro Manila palengke prices.</div>
      </div>
      <button id="bp-generate" class="btn" style="margin-top:10px">Generate My Meal Plan</button>
      <div id="bp-results" style="margin-top:12px"></div>
    </div>
  `;

  $$("#quick-add-grid .quick-add-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const m = QUICK_MEALS[parseInt(btn.dataset.idx)];
      addToDiet(m.cals, m.p, m.c, m.f);
      showToast(`Added ${m.name}`);
    });
  });

  $("diet-add").addEventListener("click", () => {
    const cals = parseInt($("add-cals").value) || 0;
    const p    = parseInt($("add-protein").value) || 0;
    const cg   = parseInt($("add-carbs").value) || 0;
    const f    = parseInt($("add-fats").value) || 0;
    if (!cals && !p && !cg && !f) return showToast("Enter at least one value");
    addToDiet(cals, p, cg, f);
    showToast("Added");
  });

  $("diet-reset").addEventListener("click", async () => {
    if (!confirm("Reset today's diet log?")) return;
    const dk = dateKey(dietDateOffset);
    await setDoc(doc(db, "users", currentUser.uid, "diet", dk),
      { calories: 0, protein: 0, carbs: 0, fats: 0, date: dk, updatedAt: serverTimestamp() },
      { merge: true });
    showToast("Reset");
  });

  // ── Budget Meal Plan ──
  $("bp-generate")?.addEventListener("click", () => {
    const budget = parseInt($("bp-amount")?.value);
    if (!budget || budget < 150) { showToast("Enter at least ₱150"); return; }
    const plan = generateBudgetPlan(budget);
    renderBudgetResults(plan);
  });

  // ── AI Photo Log ──
  $("photo-log-btn")?.addEventListener("click", () => $("photo-file-input")?.click());

  $("photo-file-input")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { showToast("Image too large (max 20 MB)"); return; }

    const panel = $("photo-panel");
    if (!panel) return;

    // Show preview
    const objURL = URL.createObjectURL(file);
    panel.style.display = "";
    panel.innerHTML = `
      <img id="photo-preview-img" src="${objURL}" class="photo-preview-img" alt="Meal preview" />
      <div style="display:flex;gap:8px;margin-top:10px">
        <button id="photo-analyze-btn" class="btn" style="flex:1">🔍 Analyze with AI</button>
        <button id="photo-cancel-btn" class="btn" style="flex:1;background:var(--bg-card);border:1px solid var(--border)">✕ Cancel</button>
      </div>
      <div id="photo-status" style="display:none;font-family:var(--font-mono);font-size:12px;color:var(--text-dim);margin-top:10px;letter-spacing:1px;text-align:center"></div>
      <div id="photo-result-area" style="display:none;margin-top:12px"></div>
    `;

    panel.querySelector("#photo-cancel-btn").addEventListener("click", () => {
      panel.style.display = "none";
      panel.innerHTML = "";
      URL.revokeObjectURL(objURL);
      e.target.value = "";
    });

    panel.querySelector("#photo-analyze-btn").addEventListener("click", async () => {
      const analyzeBtn = panel.querySelector("#photo-analyze-btn");
      const status     = $("photo-status");
      const resultArea = $("photo-result-area");
      analyzeBtn.disabled = true;
      analyzeBtn.textContent = "Analyzing…";
      status.style.display = "";
      status.textContent = "Sending to Gemini AI…";

      try {
        const base64 = await resizeImageForUpload(file);
        status.textContent = "Identifying meal…";
        const result = await analyzePhotoWithAI(base64);

        status.style.display = "none";
        analyzeBtn.style.display = "none";

        const confColor = result.confidence === "high" ? "var(--success)"
                        : result.confidence === "low"  ? "var(--danger)"
                        : "var(--gold)";
        resultArea.style.display = "";
        resultArea.innerHTML = `
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);letter-spacing:1.5px;margin-bottom:8px">AI ESTIMATE — review &amp; adjust before logging</div>
          <input id="pr-meal-name" class="number-input" type="text"
                 value="${result.meal_name || 'Unknown meal'}"
                 style="font-size:13px;margin-bottom:10px;width:100%" />
          <div class="form-row" style="grid-template-columns:repeat(4,minmax(0,1fr));gap:6px">
            <div class="form-field">
              <span class="form-label" style="font-size:9px">Calories</span>
              <input id="pr-cal" class="number-input" type="number" value="${result.calories||0}" style="font-size:15px;padding:8px 4px" />
            </div>
            <div class="form-field">
              <span class="form-label" style="font-size:9px">Protein (g)</span>
              <input id="pr-p" class="number-input" type="number" value="${result.protein_g||0}" style="font-size:15px;padding:8px 4px" />
            </div>
            <div class="form-field">
              <span class="form-label" style="font-size:9px">Carbs (g)</span>
              <input id="pr-c" class="number-input" type="number" value="${result.carbs_g||0}" style="font-size:15px;padding:8px 4px" />
            </div>
            <div class="form-field">
              <span class="form-label" style="font-size:9px">Fat (g)</span>
              <input id="pr-f" class="number-input" type="number" value="${result.fat_g||0}" style="font-size:15px;padding:8px 4px" />
            </div>
          </div>
          <div style="font-family:var(--font-mono);font-size:10px;margin-top:8px;padding:8px;background:var(--bg-elev);border-radius:6px;border-left:3px solid ${confColor}">
            <span style="color:${confColor};text-transform:uppercase">Confidence: ${result.confidence || 'medium'}</span>
            ${result.notes ? ` — ${result.notes}` : ''}
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button id="pr-add-btn" class="btn" style="flex:1">✓ Add to ${dietDateOffset === 0 ? "Today" : dietDateOffset === -1 ? "Yesterday" : "Log"}</button>
            <button id="pr-retry-btn" class="btn" style="flex:1;background:var(--bg-card);border:1px solid var(--border)">↺ Try Another</button>
          </div>
        `;

        resultArea.querySelector("#pr-add-btn").addEventListener("click", async () => {
          const cals = parseInt($("pr-cal")?.value) || 0;
          const p    = parseInt($("pr-p")?.value)   || 0;
          const cg   = parseInt($("pr-c")?.value)   || 0;
          const f    = parseInt($("pr-f")?.value)    || 0;
          await addToDiet(cals, p, cg, f);
          const name = $("pr-meal-name")?.value || "Photo meal";
          showToast(`Added: ${name}`);
          panel.style.display = "none";
          panel.innerHTML = "";
          URL.revokeObjectURL(objURL);
          e.target.value = "";
        });

        resultArea.querySelector("#pr-retry-btn").addEventListener("click", () => {
          panel.style.display = "none";
          panel.innerHTML = "";
          URL.revokeObjectURL(objURL);
          e.target.value = "";
          $("photo-file-input")?.click();
        });
      } catch (err) {
        console.error("Photo analyze error:", err);
        status.textContent = "";
        status.style.display = "none";
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = "🔍 Retry";
        showToast("Analysis failed: " + (err.message || "unknown error"), 3000);
      }
    });

    e.target.value = ""; // allow re-selecting same file
  });
}

async function addToDiet(cals, p, cg, f) {
  const cur = dietDoc || { calories: 0, protein: 0, carbs: 0, fats: 0 };
  const dk = dateKey(dietDateOffset);
  await setDoc(doc(db, "users", currentUser.uid, "diet", dk), {
    calories: (cur.calories || 0) + cals,
    protein:  (cur.protein  || 0) + p,
    carbs:    (cur.carbs    || 0) + cg,
    fats:     (cur.fats     || 0) + f,
    date: dk,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

function macroBar(name, current, target, unitLabel, klass, pctFn, statusFn) {
  const p = pctFn(current, target);
  const s = statusFn(current, target);
  const valColor = s === "over" ? "over" : (s === "met" ? "met" : "current");
  return `<div class="macro-progress">
    <div class="macro-prog-header">
      <span class="macro-prog-name">${name}</span>
      <span class="macro-prog-vals">
        <span class="${valColor}">${current}</span>
        <span class="target">/ ${target} ${unitLabel}</span>
      </span>
    </div>
    <div class="macro-prog-bar">
      <div class="macro-prog-fill ${s === "over" ? "over" : klass}" style="width:${Math.min(100, p)}%"></div>
    </div>
  </div>`;
}

function renderFoodRecs(need, current, targets) {
  const sections = [];
  const proteinPct = current.protein / targets.protein;
  const carbsPct   = current.carbs   / targets.carbs;
  const fatsPct    = current.fats    / targets.fats;

  if (proteinPct < 0.95) {
    const picks = pickFoods(FOODS.protein, "p", need.protein, 4);
    sections.push(makeFoodSection("Protein Picks", need.protein, "g protein", "p", picks));
  }
  if (carbsPct < 0.95 && need.carbs > 15) {
    const picks = pickFoods(FOODS.carbs, "c", need.carbs, 3);
    sections.push(makeFoodSection("Carb Sources", need.carbs, "g carbs", "c", picks));
  }
  if (fatsPct < 0.95 && need.fats > 5) {
    const picks = pickFoods(FOODS.fats, "f", need.fats, 3);
    sections.push(makeFoodSection("Healthy Fats", need.fats, "g fat", "f", picks));
  }
  if (sections.length === 0) {
    return `<div class="empty" style="padding:24px;color:var(--success);font-family:var(--font-mono);font-size:13px;letter-spacing:1px;text-transform:uppercase">✓ All targets hit for today</div>`;
  }
  return sections.join("");
}

function pickFoods(list, macroKey, amountNeeded, count) {
  return [...list].sort((a, b) =>
    Math.abs(a[macroKey] - amountNeeded / 2) - Math.abs(b[macroKey] - amountNeeded / 2)
  ).slice(0, count);
}

function makeFoodSection(title, need, needUnit, macroKey, foods) {
  const macroLabel = macroKey === "p" ? "p" : macroKey === "c" ? "c" : "f";
  return `<div class="food-rec-section">
    <div class="food-rec-header">
      <div class="food-rec-title">${title}</div>
      <div class="food-rec-need">${need}${needUnit.split(" ")[0]} ${needUnit.split(" ").slice(1).join(" ").toUpperCase()} LEFT</div>
    </div>
    <div class="food-items">
      ${foods.map(food => `<div class="food-item">
        <span class="food-item-name">${food.name}</span>
        <span class="food-item-portion">${food.portion}</span>
        <span class="food-item-macro">${food[macroKey]}${macroLabel}</span>
      </div>`).join("")}
    </div>
  </div>`;
}

function renderDietGate(container) {
  container.innerHTML = `
    <div class="diet-gate">
      <div class="diet-gate-title">SET YOUR TARGETS</div>
      <div class="diet-gate-sub">We use Mifflin-St Jeor + your goal<br/>to calculate accurate daily macros.</div>

      ${(!userProfile.weight || !userProfile.height || !userProfile.age || !userProfile.sex) ? `
        <div class="form-row" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:8px">
          <div class="form-field">
            <span class="form-label">Height (cm)</span>
            <input id="dg-h" class="number-input" type="number" inputmode="numeric" min="100" max="250" placeholder="175" value="${userProfile.height || ''}"/>
          </div>
          <div class="form-field">
            <span class="form-label">Weight (kg)</span>
            <input id="dg-w" class="number-input" type="number" inputmode="decimal" min="30" max="300" step="0.1" placeholder="78" value="${userProfile.weight || ''}"/>
          </div>
        </div>
        <div class="form-row" style="grid-template-columns:repeat(2,minmax(0,1fr));margin-bottom:14px">
          <div class="form-field">
            <span class="form-label">Age</span>
            <input id="dg-age" class="number-input" type="number" inputmode="numeric" min="13" max="100" placeholder="25" value="${userProfile.age || ''}"/>
          </div>
          <div class="form-field">
            <span class="form-label">Sex</span>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;background:var(--bg-elev);border:1px solid var(--border);border-radius:6px;padding:3px">
              <button type="button" id="dg-sex-m" class="lift-btn ${userProfile.sex === 'male' ? 'active' : ''}" style="padding:10px 4px;font-size:11px">Male</button>
              <button type="button" id="dg-sex-f" class="lift-btn ${userProfile.sex === 'female' ? 'active' : ''}" style="padding:10px 4px;font-size:11px">Female</button>
            </div>
          </div>
        </div>
      ` : ''}

      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;text-align:left">Activity Level</div>
      <div class="activity-select">
        ${ACTIVITY_LEVELS.map(a => `<button type="button" class="activity-btn ${userProfile.activity === a.id ? 'active' : ''}" data-act="${a.id}">
          <div>
            <div class="activity-btn-name">${a.name}</div>
            <div class="activity-btn-desc">${a.desc}</div>
          </div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--accent-light);font-weight:600">×${a.multiplier}</div>
        </button>`).join("")}
      </div>

      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;text-align:left">Goal</div>
      <div class="goal-select">
        ${GOALS.map(g => `<button type="button" class="goal-btn ${userProfile.goal === g.id ? 'active' : ''}" data-goal="${g.id}">
          ${g.name}
          <span class="goal-btn-sub">${g.label}</span>
        </button>`).join("")}
      </div>

      <button id="dg-submit" class="btn" style="margin-top:6px">Calculate Targets</button>
    </div>
  `;

  let selectedSex = userProfile.sex || null;
  let selectedActivity = userProfile.activity || null;
  let selectedGoal = userProfile.goal || null;

  $("dg-sex-m")?.addEventListener("click", () => {
    selectedSex = "male";
    $("dg-sex-m").classList.add("active");
    $("dg-sex-f").classList.remove("active");
  });
  $("dg-sex-f")?.addEventListener("click", () => {
    selectedSex = "female";
    $("dg-sex-f").classList.add("active");
    $("dg-sex-m").classList.remove("active");
  });

  $$(".activity-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedActivity = btn.dataset.act;
      $$(".activity-btn").forEach(b => b.classList.toggle("active", b === btn));
    });
  });

  $$(".goal-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedGoal = btn.dataset.goal;
      $$(".goal-btn").forEach(b => b.classList.toggle("active", b === btn));
    });
  });

  $("dg-submit").addEventListener("click", async () => {
    const update = {};
    if ($("dg-h")) {
      const h = parseFloat($("dg-h").value);
      const w = parseFloat($("dg-w").value);
      const a = parseInt($("dg-age").value);
      if (!h || !w || !a) return showToast("Fill all fields");
      if (!selectedSex) return showToast("Pick a sex");
      update.height = h;
      update.weight = w;
      update.age = a;
      update.sex = selectedSex;
    }
    if (!selectedActivity) return showToast("Pick activity level");
    if (!selectedGoal) return showToast("Pick a goal");
    update.activity = selectedActivity;
    update.goal = selectedGoal;
    // Also auto-generate routine if we just set height/weight
    if (update.height && update.weight && !userProfile.routine) {
      update.routine = recommendedRoutine(getBMI(update.height, update.weight));
    }
    await setDoc(doc(db, "users", currentUser.uid), update, { merge: true });
    showToast("Targets calculated");
  });
}

$("diet-prev").addEventListener("click", () => { dietDateOffset -= 1; loadDiet(); });
$("diet-next").addEventListener("click", () => { if (dietDateOffset < 0) { dietDateOffset += 1; loadDiet(); } });

// ============================================================
// PROFILE
// ============================================================
function renderProfile() {
  if (!userProfile.displayName) return;
  const name = userProfile.displayName;
  $("profile-name-display").textContent = name;
  $("profile-email-display").textContent = userProfile.email || "—";

  const created = userProfile.createdAt?.toDate?.();
  $("profile-meta").textContent = created
    ? "Member since " + created.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : "Member since recently";
  refreshAvatarDisplay();

  $("profile-row-name").textContent = name;
  $("profile-row-email").textContent = userProfile.email || "—";
  $("profile-row-height").textContent = userProfile.height ? `${userProfile.height} cm` : "Not set";
  $("profile-row-weight").textContent = userProfile.weight ? `${userProfile.weight} kg` : "Not set";
  $("profile-row-age").textContent = userProfile.age ? `${userProfile.age} yrs` : "Not set";
  $("profile-row-sex").textContent = userProfile.sex
    ? userProfile.sex.charAt(0).toUpperCase() + userProfile.sex.slice(1)
    : "Not set";

  // Stats
  const total = getTotalE1RM(userProfile.prs);
  const tier = getTier(total, userProfile.weight);
  $("profile-stat-total").textContent = formatWeight(total);
  $("profile-stat-total-unit").textContent = unit;
  $("profile-stat-tier").textContent = tier.name;
  $("profile-stat-tier-level").textContent = "Level " + tier.level;
  $("profile-stat-workouts").textContent = workoutsCache.length;

  const bmi = getBMI(userProfile.height, userProfile.weight);
  if (bmi) {
    $("profile-stat-bmi").textContent = bmi.toFixed(1);
    $("profile-stat-bmi-cat").textContent = bmiCategory(bmi).toUpperCase();
  } else {
    $("profile-stat-bmi").textContent = "—";
    $("profile-stat-bmi-cat").textContent = "SET H/W";
  }

  $("profile-unit-kg").classList.toggle("active", unit === "kg");
  $("profile-unit-lb").classList.toggle("active", unit === "lb");
}

// Profile edit actions
$$('#page-profile [data-action]').forEach(btn => {
  btn.addEventListener("click", async () => {
    const action = btn.dataset.action;
    const updates = {};
    if (action === "edit-name") {
      const v = prompt("Display Name", userProfile.displayName || "");
      if (v && v.trim()) {
        updates.displayName = v.trim().slice(0, 20);
        await updateProfile(currentUser, { displayName: updates.displayName });
      }
    } else if (action === "edit-height") {
      const v = prompt("Height in cm", userProfile.height || "");
      const n = parseFloat(v);
      if (n && n >= 100 && n <= 250) updates.height = n;
      else if (v !== null) return showToast("Height must be 100-250 cm");
    } else if (action === "edit-weight") {
      const v = prompt("Weight in kg", userProfile.weight || "");
      const n = parseFloat(v);
      if (n && n >= 30 && n <= 300) updates.weight = n;
      else if (v !== null) return showToast("Weight must be 30-300 kg");
    } else if (action === "edit-age") {
      const v = prompt("Age in years", userProfile.age || "");
      const n = parseInt(v);
      if (n && n >= 13 && n <= 100) updates.age = n;
      else if (v !== null) return showToast("Age must be 13-100");
    } else if (action === "edit-sex") {
      const v = prompt("Sex (male/female)", userProfile.sex || "");
      if (v && (v.toLowerCase() === "male" || v.toLowerCase() === "female")) updates.sex = v.toLowerCase();
      else if (v !== null) return showToast("Enter male or female");
    }

    if (Object.keys(updates).length) {
      await setDoc(doc(db, "users", currentUser.uid), updates, { merge: true });
      showToast("Saved");
    }
  });
});

// ============================================================
// INSTALL HINT
// ============================================================
function maybeShowInstallHint() {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const dismissed = localStorage.getItem("primelift-install-dismissed");
  if (!standalone && !dismissed) $("install-hint").style.display = "block";
}
$("install-hint-close").addEventListener("click", () => {
  $("install-hint").style.display = "none";
  localStorage.setItem("primelift-install-dismissed", "1");
});

// ============================================================
// MASTER RENDER (after unit change)
// ============================================================
function renderAll() {
  renderTierBanner();
  renderPRs();
  renderRecent();
  const activePage = document.querySelector(".page.active")?.id;
  if (activePage === "page-rank")    renderRank();
  if (activePage === "page-routine") renderRoutine();
  if (activePage === "page-diet")    renderDiet();
  if (activePage === "page-profile") renderProfile();
}
