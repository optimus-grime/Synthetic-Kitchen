export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'admin' | 'user';
}

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  category: string;
  expiryDate?: string;
  lowStockThreshold?: number;
  image?: string;
  price?: number;
  lifetimePurchased?: number;
  lifetimeSpent?: number;
  needToBuy?: boolean;
  uid: string;
}

export interface Ingredient {
  name: string;
  amount: number;
  unit: string;
}

export interface Recipe {
  id: string;
  title: string;
  description: string;
  image: string;
  prepTime: number;
  calories: number;
  estimatedCost?: number;
  ingredients: Ingredient[];
  instructions: string[];
  tags: string[];
  isFavorite: boolean;
  uid: string;
}

export interface Meal {
  id: string;
  date: string;
  type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  recipeId?: string;
  recipeTitle?: string;
  recipeImage?: string;
  calories?: number;
  estimatedCost?: number;
  prepTime?: number;
  ingredients?: Ingredient[];
  uid: string;
}

export interface GroceryItem {
  id: string;
  name: string;
  amount?: number;
  unit?: string;
  category?: string;
  completed: boolean;
  uid: string;
}
