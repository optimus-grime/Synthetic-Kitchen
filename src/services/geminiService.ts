export async function identifyIngredients(base64Image: string): Promise<any[]> {
  try {
    const response = await fetch('/api/identify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: base64Image }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Gemini identification error:", error);
    throw error;
  }
}

export async function consolidateGroceries(ingredients: any[]): Promise<any[]> {
  try {
    const response = await fetch('/api/consolidate-groceries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ingredients }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Gemini consolidation error:", error);
    throw error;
  }
}

export async function generateBudgetMealPlan(): Promise<any[]> {
  try {
    const response = await fetch('/api/mealplan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("Gemini meal plan error:", error);
    throw error;
  }
}
