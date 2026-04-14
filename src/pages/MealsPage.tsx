import React, { useState, useEffect, useMemo } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, orderBy, addDoc, getDocs, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { Meal, GroceryItem, InventoryItem } from '../types';
import { useAuthState } from 'react-firebase-hooks/auth';
import { motion } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { generateBudgetMealPlan } from '../services/geminiService';
import { useNavigate } from 'react-router-dom';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function MealsPage() {
  const [user] = useAuthState(auth);
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [meals, setMeals] = useState<Meal[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAutoPlanning, setIsAutoPlanning] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{title: string, message: string, action: () => void} | null>(null);

  // Calculate the start of the current week (Monday)
  const weekStart = useMemo(() => {
    const d = new Date(currentDate);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
    return new Date(d.setDate(diff));
  }, [currentDate]);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    return new Date(d.setDate(d.getDate() + 13));
  }, [weekStart]);

  const weekNumber = useMemo(() => {
    const d = new Date(currentDate);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  }, [currentDate]);

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'meals'),
      where('uid', '==', user.uid),
      orderBy('date', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const mealsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Meal));
      setMeals(mealsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'meals');
    });

    return () => unsubscribe();
  }, [user]);

  const navigateWeek = (direction: number) => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + (direction * 14));
    setCurrentDate(newDate);
  };

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const handleAutoPlan = async () => {
    if (!user) return;
    setIsAutoPlanning(true);
    try {
      // Fetch current inventory
      const inventorySnapshot = await getDocs(query(collection(db, 'inventory'), where('uid', '==', user.uid)));
      const inventory = inventorySnapshot.docs.map(doc => doc.data() as { name: string, quantity: number, unit: string });
      
      const inventoryNames = inventory.map(i => i.name).join(', ');

      const newRecipes = await generateBudgetMealPlan(inventoryNames);
      
      for (let i = 0; i < newRecipes.length; i++) {
        const recipeData = newRecipes[i];
        
        // Add Recipe
        const recipeRef = await addDoc(collection(db, 'recipes'), {
          uid: user.uid,
          title: recipeData.title,
          description: recipeData.description,
          prepTime: recipeData.prepTime,
          calories: recipeData.calories,
          estimatedCost: recipeData.estimatedCost,
          image: `https://loremflickr.com/800/600/${encodeURIComponent(recipeData.title.split(' ')[0])}`,
          ingredients: recipeData.ingredients,
          instructions: recipeData.instructions,
          tags: ['Budget', 'Auto-Planned'],
          isFavorite: false
        });

        // Add Meal (schedule for the next 7 days starting from currentDate)
        const mealDate = new Date(currentDate);
        mealDate.setDate(mealDate.getDate() + i);
        
        await addDoc(collection(db, 'meals'), {
          uid: user.uid,
          recipeId: recipeRef.id,
          recipeTitle: recipeData.title,
          recipeImage: `https://loremflickr.com/800/600/${encodeURIComponent(recipeData.title.split(' ')[0])}`,
          date: mealDate.toISOString(),
          type: 'dinner',
          calories: recipeData.calories,
          estimatedCost: recipeData.estimatedCost,
          prepTime: recipeData.prepTime,
          ingredients: recipeData.ingredients
        });
      }
    } catch (error) {
      console.error("Auto-plan failed", error);
      alert("Failed to generate meal plan. Please try again.");
    } finally {
      setIsAutoPlanning(false);
    }
  };

  const filteredMeals = useMemo(() => {
    return meals.filter(meal => {
      const mealDate = new Date(meal.date);
      return mealDate.toDateString() === currentDate.toDateString();
    });
  }, [meals, currentDate]);

  const missingIngredients = useMemo(() => {
    const required = new Map<string, {amount: number, unit: string}>();
    
    // Filter out common ingredients that shouldn't be added to the grocery list
    const ignoreList = ['water', 'salt', 'pepper', 'black pepper', 'tap water'];

    meals.forEach(meal => {
      meal.ingredients?.forEach(ing => {
        const key = ing.name.toLowerCase().trim();
        if (ignoreList.includes(key)) return;
        
        if (!required.has(key)) required.set(key, { amount: 0, unit: ing.unit });
        required.get(key)!.amount += Number(ing.amount);
      });
    });

    const missing: any[] = [];
    required.forEach((req, name) => {
      const invItem = inventory.find(i => i.name.toLowerCase() === name);
      const invAmount = invItem ? Number(invItem.quantity) : 0;
      
      if (invAmount < req.amount) {
        missing.push({ 
          name: name.charAt(0).toUpperCase() + name.slice(1), 
          amount: req.amount - invAmount, 
          unit: req.unit, 
          category: 'General' 
        });
      }
    });

    return missing;
  }, [meals, inventory]);

  const handleUpdateGroceryList = async () => {
    if (!user || missingIngredients.length === 0) return;
    try {
      for (const item of missingIngredients) {
        const existingItem = inventory.find(i => i.name.toLowerCase() === item.name.toLowerCase());
        if (existingItem) {
          await updateDoc(doc(db, 'inventory', existingItem.id), {
            needToBuy: true
          });
        } else {
          await addDoc(collection(db, 'inventory'), {
            name: item.name,
            uid: user.uid,
            quantity: 0,
            price: 0,
            unit: item.unit || 'unit',
            category: 'General',
            lowStockThreshold: 0,
            lifetimePurchased: 0,
            lifetimeSpent: 0,
            needToBuy: true
          });
        }
      }
      navigate('/inventory');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'inventory');
    }
  };

  const handleDeleteMeal = (mealId: string) => {
    if (!user) return;
    setConfirmAction({
      title: 'Remove Meal',
      message: 'Are you sure you want to remove this meal from the plan?',
      action: async () => {
        try {
          await deleteDoc(doc(db, 'meals', mealId));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `meals/${mealId}`);
        }
      }
    });
  };

  const handleClearWeek = () => {
    if (!user) return;
    setConfirmAction({
      title: 'Clear Week',
      message: 'Are you sure you want to clear all meals for this week?',
      action: async () => {
        setIsAutoPlanning(true);
        try {
          // Find all meals in the current week
          const weekMeals = meals.filter(meal => {
            const mealDate = new Date(meal.date);
            return mealDate >= weekStart && mealDate <= weekEnd;
          });
          
          for (const meal of weekMeals) {
            await deleteDoc(doc(db, 'meals', meal.id));
          }
        } catch (error) {
          console.error("Failed to clear week", error);
        } finally {
          setIsAutoPlanning(false);
        }
      }
    });
  };

  const totalMealsCost = meals.reduce((sum, meal) => sum + (Number(meal.estimatedCost) || 0), 0);
  const avgCostPerMeal = meals.length > 0 ? (totalMealsCost / meals.length) : 0;
  const estimatedMonthlyCost = avgCostPerMeal * 30; // Rough estimate for 30 dinners

  const top5PantryItems = useMemo(() => {
    return [...inventory]
      .sort((a, b) => (b.lifetimePurchased || 0) - (a.lifetimePurchased || 0))
      .slice(0, 5);
  }, [inventory]);

  return (
    <div className="space-y-10">
      {/* Date Selector / Timeline */}
      <section>
        <div className="flex flex-col md:flex-row md:items-center gap-4 mb-6">
          <div>
            <span className="font-headline text-primary uppercase tracking-widest text-xs font-bold">Week {weekNumber}</span>
            <h2 className="font-headline text-4xl font-light tracking-tighter mt-1">
              {monthNames[weekStart.getMonth()]} {weekStart.getDate()}—{weekStart.getMonth() !== weekEnd.getMonth() ? monthNames[weekEnd.getMonth()] + ' ' : ''}{weekEnd.getDate()}
            </h2>
          </div>
          <div className="flex items-center gap-2 md:ml-auto">
            <button 
              onClick={handleClearWeek}
              className="px-4 py-2 bg-error/10 text-error border border-error/20 rounded-xl font-headline text-xs font-bold uppercase tracking-widest hover:bg-error hover:text-on-primary transition-all flex items-center gap-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">delete_sweep</span>
              Clear Week
            </button>
            <button 
              onClick={handleAutoPlan}
              disabled={isAutoPlanning}
              className="px-4 py-2 bg-secondary/20 text-secondary border border-secondary/30 rounded-xl font-headline text-xs font-bold uppercase tracking-widest hover:bg-secondary hover:text-on-secondary transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm">{isAutoPlanning ? 'sync' : 'auto_awesome'}</span>
              {isAutoPlanning ? 'Planning...' : 'Auto-Plan Week'}
            </button>
            <div className="hidden md:flex gap-2">
              <button 
                onClick={() => navigateWeek(-1)}
                className="p-2 rounded-xl bg-surface-container-high text-on-surface hover:bg-surface-bright transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined">chevron_left</span>
              </button>
              <button 
                onClick={() => navigateWeek(1)}
                className="p-2 rounded-xl bg-surface-container-high text-on-surface hover:bg-surface-bright transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>
        </div>

        {/* Horizontal Scrollable Calendar Labels */}
        <div className="flex gap-4 overflow-x-auto hide-scrollbar pb-4 -mx-4 px-4">
          {Array.from({ length: 14 }).map((_, i) => {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
            const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
            const isToday = date.toDateString() === new Date().toDateString();
            const isSelected = date.toDateString() === currentDate.toDateString();

            return (
              <div
                key={date.toISOString()}
                onClick={() => setCurrentDate(date)}
                className={cn(
                  "flex-shrink-0 w-24 aspect-[3/4] flex flex-col items-center justify-center rounded-xl border transition-all duration-300 cursor-pointer",
                  isSelected 
                    ? "bg-primary text-on-primary ring-4 ring-primary/20 scale-105 border-primary" 
                    : "bg-surface-container border-outline-variant/20 opacity-50 hover:opacity-100"
                )}
              >
                <span className={cn("font-label text-[10px] uppercase tracking-widest", isSelected ? "font-bold" : "opacity-50")}>{dayName}</span>
                <span className={cn("font-headline font-bold", isSelected ? "text-3xl" : "text-2xl")}>{date.getDate()}</span>
                {isToday && <div className={cn("w-1.5 h-1.5 rounded-full mt-1", isSelected ? "bg-on-primary" : "bg-primary")}></div>}
              </div>
            );
          })}
        </div>
      </section>

      {/* Bento Layout for Daily Meals */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        <div className="md:col-span-8 space-y-6">
          {loading ? (
            <div className="animate-pulse space-y-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-48 bg-surface-container rounded-xl"></div>
              ))}
            </div>
          ) : filteredMeals.length > 0 ? (
            filteredMeals.map((meal) => (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                key={meal.id}
                className="group relative overflow-hidden bg-surface-container rounded-xl border border-outline-variant/10 hover:border-primary/30 transition-all duration-300"
              >
                <div className="flex flex-col sm:flex-row">
                  <div className="p-6 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-primary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                            {meal.type === 'breakfast' ? 'wb_twilight' : meal.type === 'lunch' ? 'light_mode' : 'dark_mode'}
                          </span>
                          <span className="font-label text-[10px] uppercase tracking-[0.2em] text-primary font-bold">
                            {meal.type}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteMeal(meal.id)}
                          className="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center text-error transition-all active:scale-90 hover:bg-error/10 cursor-pointer"
                          title="Remove Meal"
                        >
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      </div>
                      <h3 className="font-headline text-2xl font-bold mb-2">{meal.recipeTitle}</h3>
                      <p className="text-on-surface-variant text-sm leading-relaxed max-w-md">Scheduled meal for your NEON PANTRY nutrition plan.</p>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex gap-4">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-secondary">${(meal.estimatedCost || 0).toFixed(2)} / MEAL</span>
                        <span className="text-[10px] uppercase tracking-wider font-bold text-outline">{meal.prepTime || 0} MIN</span>
                      </div>
                      <button 
                        onClick={() => navigate('/recipes')}
                        className="inline-flex items-center gap-2 font-headline text-xs font-bold uppercase tracking-widest text-primary hover:gap-3 transition-all cursor-pointer bg-transparent border-none"
                      >
                        View Recipe <span className="material-symbols-outlined text-sm">arrow_forward</span>
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))
          ) : (
            <div className="text-center py-20 bg-surface-container rounded-xl border border-dashed border-outline-variant/30">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-4">restaurant</span>
              <p className="text-on-surface-variant">No meals scheduled for today.</p>
            </div>
          )}
        </div>

        {/* Sidebar: Nutrition & Grocery Stats */}
        <div className="md:col-span-4 space-y-6">
          <div className="bg-surface-container-high rounded-xl p-6 border border-outline-variant/10">
            <h4 className="font-headline text-lg font-bold mb-6 flex items-center justify-between">
              Budget Insights
              <span className="material-symbols-outlined text-secondary">payments</span>
            </h4>
            <div className="space-y-6">
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">Avg. Cost Per Meal</p>
                <p className="text-3xl font-headline font-black text-primary">${avgCostPerMeal.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">Est. Monthly Dinner Cost</p>
                <p className="text-2xl font-headline font-bold text-on-surface">${estimatedMonthlyCost.toFixed(2)}</p>
              </div>
              
              <div className="pt-4 border-t border-outline-variant/20">
                <p className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-4">Top 5 Most Purchased Items</p>
                <div className="space-y-3">
                  {top5PantryItems.length > 0 && top5PantryItems.some(i => i.lifetimePurchased) ? top5PantryItems.filter(i => i.lifetimePurchased).map((item, idx) => (
                    <div key={item.id} className="flex justify-between items-center text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-on-surface-variant/50 font-bold text-xs">{idx + 1}.</span>
                        <span className="font-medium truncate max-w-[120px]">{item.name}</span>
                        <span className="text-[10px] text-on-surface-variant bg-surface-container px-1.5 py-0.5 rounded">x{item.lifetimePurchased}</span>
                      </div>
                      <span className="font-bold text-secondary">
                        ${(item.lifetimeSpent || 0).toFixed(2)}
                      </span>
                    </div>
                  )) : (
                    <p className="text-xs text-on-surface-variant italic">Add items to inventory to track purchases.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-surface-container-highest rounded-xl p-6 border border-primary/20">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined">shopping_cart_checkout</span>
              </div>
              <div>
                <h4 className="font-headline font-bold text-lg">Inventory Sync</h4>
                <p className="text-[10px] uppercase tracking-widest text-primary font-bold">
                  {missingIngredients.length} Ingredients Missing
                </p>
              </div>
            </div>
            <p className="text-on-surface-variant text-xs mb-6 leading-relaxed">
              {missingIngredients.length > 0 
                ? `Your pantry is missing key items for today's meals (e.g., ${missingIngredients[0].name}). Auto-add to grocery list?`
                : `You have all the ingredients needed for today's meals!`}
            </p>
            <button 
              onClick={handleUpdateGroceryList}
              disabled={missingIngredients.length === 0}
              className="w-full py-3 bg-primary text-on-primary font-headline text-xs font-bold uppercase tracking-widest rounded-xl hover:opacity-90 transition-opacity active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Update Grocery List
            </button>
          </div>
        </div>
      </div>

      {/* Confirm Modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="absolute inset-0 bg-background/80 backdrop-blur-sm" 
            onClick={() => setConfirmAction(null)} 
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            exit={{ opacity: 0, scale: 0.95 }} 
            className="relative bg-surface-container p-6 rounded-2xl max-w-sm w-full border border-outline-variant/30 shadow-2xl"
          >
            <h3 className="font-headline text-xl font-bold mb-2">{confirmAction.title}</h3>
            <p className="text-on-surface-variant text-sm mb-6">{confirmAction.message}</p>
            <div className="flex gap-3">
              <button 
                onClick={() => setConfirmAction(null)} 
                className="flex-1 py-3 rounded-xl border border-outline-variant font-headline font-bold text-xs uppercase tracking-widest hover:bg-surface-container-high transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={() => { confirmAction.action(); setConfirmAction(null); }} 
                className="flex-1 py-3 rounded-xl bg-error text-on-primary font-headline font-bold text-xs uppercase tracking-widest hover:brightness-110 transition-all shadow-lg"
              >
                Confirm
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}


