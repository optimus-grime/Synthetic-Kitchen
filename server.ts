import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Increase payload limit for base64 images
app.use(express.json({ limit: '50mb' }));

// API Routes
app.post("/api/identify", async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: "Image is required" });
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
    console.error("Gemini identification error:", error);
    res.status(500).json({ error: "Failed to identify items" });
  }
});

app.post("/api/mealplan", async (req, res) => {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
    
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `You are a budget-conscious meal planner. Generate 14 ultra-basic, extremely simple, and highly budget-friendly dinner recipes. 
      IMPORTANT: The user frequently cooks with an Air Fryer. Please ensure at least 6-7 of these recipes are specifically designed for or highly optimized for an Air Fryer (and mention it in the title or description).
      
      DIETARY RESTRICTIONS & PREFERENCES:
      - Dislikes: DO NOT include mushrooms or liver.
      - Texture: Avoid hard-to-chew foods (e.g., raw carrots, nuts, raw apples). Strongly prefer soft textures over crunchy or crispy results.
      - Spice Level: Strictly mild. Avoid anything spicy and do not use "medium" or "hot" heat levels.
      
      RECIPE STYLE:
      - Focus on the most affordable, common ingredients (e.g., ground beef, chicken thighs, rice, beans, pasta, frozen veggies, canned tomatoes, eggs).
      - Keep it VERY basic: 5 or fewer main ingredients per recipe.
      - No expensive, organic, vegan, or fancy ingredients. No complex cooking techniques.
      
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
    console.error("Gemini meal plan error:", error);
    res.status(500).json({ error: "Failed to generate meal plan" });
  }
});

app.post("/api/consolidate-groceries", async (req, res) => {
  try {
    const { ingredients } = req.body;
    if (!ingredients || !Array.isArray(ingredients)) {
      return res.status(400).json({ error: "Ingredients array is required" });
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
    console.error("Gemini consolidation error:", error);
    res.status(500).json({ error: "Failed to consolidate groceries" });
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

  app.listen(PORT, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
