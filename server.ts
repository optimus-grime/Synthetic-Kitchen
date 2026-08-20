import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import seedRecipesData from "./src/data/seedRecipes.json";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Increase payload limit for base64 images
app.use(express.json({ limit: '50mb' }));

let apiKeyMarkedInvalid = false;

function hasValidApiKey(): boolean {
  if (apiKeyMarkedInvalid) return false;
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.trim() === '' || key.toLowerCase().includes('placeholder') || key.toLowerCase().includes('your_api_key')) {
    return false;
  }
  return true;
}

function handleGeminiError(error: any) {
  const errStr = String(error?.message || error || '');
  if (errStr.includes('API_KEY_INVALID') || errStr.includes('API key not valid') || errStr.includes('400') || errStr.includes('INVALID_ARGUMENT') || errStr.includes('RESOURCE_EXHAUSTED') || errStr.includes('quota exceeded') || errStr.includes('429') || errStr.includes('exceeded')) {
    apiKeyMarkedInvalid = true;
    console.warn("Gemini API quota exceeded or key invalid. Falling back to seed data/defaults.");
  } else {
    console.error("Gemini API error:", error);
  }
}

// API Routes
app.post("/api/identify", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: "Image is required" });
    }

    if (!hasValidApiKey()) {
      return res.json([
        { name: 'Chicken Breast', category: 'Meat', confidence: 95, quantity: 1, unit: 'kg', price: 12.50 },
        { name: 'Whole Milk', category: 'Dairy', confidence: 95, quantity: 2, unit: 'L', price: 4.50 },
        { name: 'Cheddar Cheese', category: 'Dairy', confidence: 95, quantity: 500, unit: 'g', price: 7.00 }
      ]);
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { text: "Identify all food ingredients or products in this image. For each item, provide its name, a likely category (e.g., Dairy, Produce, Meat, Pantry, Canned Goods, Baking, Frozen, General), and a confidence score (0-100). Extract the price if visible (as a number). Determine the quantity (e.g., if there are 3 cans of tuna, quantity is 3). Determine the unit of measurement (e.g., 'g', 'kg', 'ml', 'L', 'ct' for count/pieces). Use Canadian metric units. If it's a screenshot from walmart.ca or a Canadian receipt, extract all items, prices, and quantities accurately." },
          { inlineData: { mimeType: "image/jpeg", data: image } }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              category: { type: Type.STRING },
              confidence: { type: Type.NUMBER },
              expiryDays: { type: Type.NUMBER, description: "Estimated shelf life in days" },
              price: { type: Type.NUMBER, description: "Price in CAD if visible" },
              quantity: { type: Type.NUMBER, description: "Number of items or amount" },
              unit: { type: Type.STRING, description: "Unit of measurement (e.g., g, kg, ml, L, ct)" }
            },
            required: ["name", "category", "confidence", "quantity", "unit"]
          }
        }
      }
    });

    const text = response.text?.trim() || "[]";
    res.json(JSON.parse(text));
  } catch (error) {
    handleGeminiError(error);
    res.json([
      { name: 'Identified Item', category: 'General', confidence: 90, quantity: 1, unit: 'unit', price: 5.00 }
    ]);
  }
});

app.post("/api/mealplan", async (req, res) => {
  try {
    const { inventory, preferences } = req.body;

    if (!hasValidApiKey()) {
      return res.json(seedRecipesData.slice(0, 7));
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a budget-conscious meal planner. Generate 14 classic Western-style comfort food dinner recipes (e.g., hamburgers, hot dogs, meatloaf, simple pastas, roasted or air-fried meats, basic stews). Avoid any niche, experimental, or weird ingredient combinations (like combining unrelated proteins and starches into bizarre mashups).
      IMPORTANT: The user frequently cooks with an Air Fryer. Please ensure at least 6-7 of these recipes are specifically designed for or highly optimized for an Air Fryer (and mention it in the title or description).
      
      DIETARY RESTRICTIONS & PREFERENCES:
      ${preferences || '- Dislikes: STRICTLY EXCLUDE mushrooms, liver, red lentils, and spicy elements.\n- Texture & Comfort: Prioritize simple, soft-texture comfort foods (tender cooked meats, comforting soups, mashed or soft vegetable sides, stews, pasta dishes) over hard, crunchy, or chewy textures.\n- Spice Level: Strictly mild. Avoid anything spicy (no chili, no hot sauce, no cayenne, no jalapeños, no spicy pepper flakes) and do not use "medium" or "hot" heat levels.'}
      
      RECIPE STYLE & INGREDIENT RULES:
      - Focus on everyday, basic ingredients. You can reference the user's current inventory for inspiration, but you are **not** restricted exclusively to what is currently stocked—feel free to include standard grocery items that the user will need to purchase.
      - The user's current inventory (for reference): ${inventory || 'No inventory provided.'}
      - Always include basic staples like water, salt, black pepper, and cooking oil as needed.
      - Keep recipes practical: 5 to 7 main ingredients per recipe. Avoid extravagant or overly costly specialty items.
      - Ensure high variety. Do not suggest the same flavor profile or the same dish type more than once or twice in the week.
      
      Return ONLY a valid JSON array of 14 recipe objects. Each object must have:
      - title (string)
      - description (string)
      - prepTime (number, in minutes)
      - calories (number)
      - estimatedCost (number, estimated total cost in CAD to make this meal)
      - ingredients (array of objects, each with 'amount' (number), 'unit' (string, e.g., 'g', 'cup', 'unit'), and 'name' (string))
      - instructions (array of strings, step-by-step)`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              prepTime: { type: Type.NUMBER },
              calories: { type: Type.NUMBER },
              estimatedCost: { type: Type.NUMBER },
              ingredients: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    amount: { type: Type.NUMBER },
                    unit: { type: Type.STRING },
                    name: { type: Type.STRING }
                  },
                  required: ["amount", "unit", "name"]
                }
              },
              instructions: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["title", "description", "prepTime", "calories", "estimatedCost", "ingredients", "instructions"]
          }
        }
      }
    });

    const text = response.text?.trim() || "[]";
    res.json(JSON.parse(text));
  } catch (error) {
    handleGeminiError(error);
    res.json(seedRecipesData.slice(0, 7));
  }
});

app.post("/api/consolidate-groceries", async (req, res) => {
  try {
    const { ingredients } = req.body;
    if (!ingredients || !Array.isArray(ingredients)) {
      return res.status(400).json({ error: "Ingredients array is required" });
    }

    if (!hasValidApiKey()) {
      return res.json(ingredients.map((ing: any) => ({
        name: ing.name || 'Item',
        amount: ing.amount || 1,
        unit: ing.unit || 'unit',
        category: ing.category || 'Pantry'
      })));
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a smart grocery list assistant. I will give you a list of raw ingredients extracted from multiple recipes.
      Your job is to consolidate them into a clean, unified grocery list.
      - Combine duplicate items (e.g., "1 egg beaten", "3 large eggs", "1 egg" should become "5 eggs" or "5 unit Eggs").
      - Combine similar items (e.g., "chicken broth", "beef broth" might be combined if it makes sense, or just clean up the names to "Chicken Broth" and "Beef Broth").
      - Remove preparation instructions (e.g., "chopped", "diced", "beaten", "melted").
      - Standardize units where possible.
      - Ignore basic pantry staples like water, salt, black pepper.
      
      Raw ingredients:
      ${JSON.stringify(ingredients)}
      
      Return ONLY a JSON array of consolidated items.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Clean, consolidated ingredient name (e.g., 'Eggs', 'Chicken Broth')" },
              amount: { type: Type.NUMBER, description: "Total combined amount" },
              unit: { type: Type.STRING, description: "Unit of measurement (e.g., 'unit', 'g', 'ml', 'cup')" },
              category: { type: Type.STRING, description: "Grocery category (e.g., 'Produce', 'Dairy', 'Meat', 'Pantry')" }
            },
            required: ["name", "amount", "unit", "category"]
          }
        }
      }
    });

    const text = response.text?.trim() || "[]";
    res.json(JSON.parse(text));
  } catch (error) {
    handleGeminiError(error);
    const { ingredients = [] } = req.body || {};
    res.json((ingredients as any[]).map((ing: any) => ({
      name: ing.name || 'Item',
      amount: ing.amount || 1,
      unit: ing.unit || 'unit',
      category: ing.category || 'Pantry'
    })));
  }
});

app.post("/api/recipes/generate", async (req, res) => {
  try {
    const { query: searchQuery } = req.body;
    const searchTerm = searchQuery || "classic Western comfort food";

    if (!hasValidApiKey()) {
      const filtered = (seedRecipesData as any[]).filter(r => 
        !searchQuery || r.title.toLowerCase().includes(searchQuery.toLowerCase()) || (r.description && r.description.toLowerCase().includes(searchQuery.toLowerCase()))
      );
      return res.json(filtered.length > 0 ? filtered : seedRecipesData);
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a professional chef and recipe generator. Generate 10 to 12 practical, delicious recipes based on the search query/theme: "${searchTerm}".
      
      CORE RULES & GUIDELINES:
      - Focus: Classic Western-style comfort foods (e.g., hamburgers, meatloaf, simple pastas, roasted or air-fried meats, basic stews). Avoid niche, experimental, or weird ingredient fusions.
      - Strict Exclusions: STRICTLY EXCLUDE mushrooms, liver, red lentils, and spicy elements (no chili, hot sauce, cayenne, jalapeños, or pepper flakes). Keep flavor profiles mild.
      - Simplicity: Practical, budget-friendly, everyday ingredients (5 to 7 ingredients max per recipe) with no extravagant specialty items.
      - Air Fryer: Optimize cooking styles and instructions for an Air Fryer where relevant (mention it in the title or description).
      
      Return ONLY a valid JSON array of recipe objects. Each object must have:
      - title (string)
      - description (string)
      - prepTime (number, in minutes)
      - calories (number)
      - estimatedCost (number, estimated total cost in CAD to make this meal)
      - ingredients (array of objects, each with 'amount' (number), 'unit' (string, e.g., 'g', 'cup', 'unit'), and 'name' (string))
      - instructions (array of strings, step-by-step)`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              prepTime: { type: Type.NUMBER },
              calories: { type: Type.NUMBER },
              estimatedCost: { type: Type.NUMBER },
              ingredients: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    amount: { type: Type.NUMBER },
                    unit: { type: Type.STRING },
                    name: { type: Type.STRING }
                  },
                  required: ["amount", "unit", "name"]
                }
              },
              instructions: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["title", "description", "prepTime", "calories", "estimatedCost", "ingredients", "instructions"]
          }
        }
      }
    });

    const text = response.text?.trim() || "[]";
    res.json(JSON.parse(text));
  } catch (error) {
    handleGeminiError(error);
    const { query: searchQuery } = req.body || {};
    const filtered = (seedRecipesData as any[]).filter(r => 
      !searchQuery || r.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
    res.json(filtered.length > 0 ? filtered : seedRecipesData);
  }
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
