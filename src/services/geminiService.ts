import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function identifyIngredients(base64Image: string): Promise<any[]> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { text: "Identify all food ingredients or products in this image. For each item, provide its name, a likely category (e.g., Dairy, Produce, Meat, Pantry, Canned Goods, Baking, Frozen, General), and a confidence score (0-100). Extract the price if visible (as a number). Determine the quantity (e.g., if there are 3 cans of tuna, quantity is 3). Determine the unit of measurement (e.g., 'g', 'kg', 'ml', 'L', 'ct' for count/pieces). Use Canadian metric units. If it's a screenshot from walmart.ca or a Canadian receipt, extract all items, prices, and quantities accurately." },
          { inlineData: { mimeType: "image/jpeg", data: base64Image } }
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
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini identification error:", error);
    throw error;
  }
}

export async function generateBudgetMealPlan(): Promise<any[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `You are a budget-conscious meal planner. Generate 7 simple, low-cost, everyday dinner recipes. 
    IMPORTANT: The user frequently cooks with an Air Fryer. Please ensure at least 3-4 of these recipes are specifically designed for or highly optimized for an Air Fryer (and mention it in the title or description).
    Focus on affordable, common ingredients (e.g., ground beef, chicken thighs, rice, beans, pasta, frozen veggies). No expensive, organic, vegan, or fancy ingredients.
    Return ONLY a valid JSON array of 7 recipe objects. Each object must have:
    - title (string)
    - description (string)
    - prepTime (number, in minutes)
    - calories (number)
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
          required: ["title", "description", "prepTime", "calories", "ingredients", "instructions"]
        }
      }
    }
  });

  return JSON.parse(response.text || "[]");
}
