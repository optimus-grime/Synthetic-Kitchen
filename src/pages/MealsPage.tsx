import React, { useState, useEffect, useMemo } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, orderBy, addDoc, updateDoc, doc, deleteDoc, getDoc, writeBatch } from 'firebase/firestore';
import { Meal, Recipe, InventoryItem } from '../types';
import { useAuthState } from 'react-firebase-hooks/auth';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import seedRecipesData from '../data/seedRecipes.json';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function fisherYatesShuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default function MealsPage() {
  const [user] = useAuthState(auth);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [meals, setMeals] = useState<Meal[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAutoPlanning, setIsAutoPlanning] = useState(false);
  const [isCrossReferencing, setIsCrossReferencing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{title: string, message: string, action: () => void} | null>(null);
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [newMealModalDay, setNewMealModalDay] = useState<string | null>(null);
  const [customMealTitle, setCustomMealTitle] = useState('');

  const handleOpenRecipeModal = async (meal: Meal) => {
    const seedMatch = (seedRecipesData as any[]).find(
      r => r.id === meal.recipeId || (meal.recipeTitle && r.title.toLowerCase() === meal.recipeTitle.toLowerCase())
    );

    if (seedMatch) {
      setSelectedRecipe({
        id: seedMatch.id,
        title: seedMatch.title,
        description: seedMatch.description || 'Classic home-cooked dinner recipe.',
        image: seedMatch.image || meal.recipeImage || 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80',
        prepTime: seedMatch.prepTime || meal.prepTime || 30,
        calories: seedMatch.calories || meal.calories || 450,
        estimatedCost: seedMatch.estimatedCost || meal.estimatedCost || 10,
        ingredients: seedMatch.ingredients || meal.ingredients || [],
        instructions: seedMatch.instructions || [],
        tags: seedMatch.tags || ['Dinner'],
        isFavorite: false,
        uid: user?.uid || ''
      });
      return;
    }

    if (meal.recipeId) {
      try {
        const docSnap = await getDoc(doc(db, 'recipes', meal.recipeId));
        if (docSnap.exists()) {
          setSelectedRecipe({ id: docSnap.id, ...docSnap.data() } as Recipe);
          return;
        }
      } catch (err) {
        console.error("Error fetching recipe:", err);
      }
    }

    setSelectedRecipe({
      id: meal.recipeId || meal.id,
      title: meal.recipeTitle || 'Scheduled Dinner',
      description: 'Scheduled dinner from your meal plan.',
      image: meal.recipeImage || 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80',
      prepTime: meal.prepTime || 30,
      calories: meal.calories || 450,
      estimatedCost: meal.estimatedCost || 10,
      ingredients: meal.ingredients || [],
      instructions: ['Prepare according to recipe guidelines.'],
      tags: ['Meal Plan'],
      isFavorite: false,
      uid: user?.uid || ''
    });
  };

  const weekStart = useMemo(() => {
    const d = new Date(currentDate);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  }, [currentDate]);

  const weekEnd = useMemo(() => {
    const d = new Date(weekStart);
    return new Date(d.setDate(d.getDate() + 6));
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
    const q = query(collection(db, 'meals'), where('uid', '==', user.uid), orderBy('date', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const mealsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Meal));
      setMeals(mealsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'meals');
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'inventory'), where('uid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const invData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
      setInventory(invData);
    }, (error) => {
      console.error("Error fetching inventory", error);
    });
    return () => unsubscribe();
  }, [user]);

  const navigateWeek = (direction: number) => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + (direction * 7));
    setCurrentDate(newDate);
  };

  const days = [
    { name: 'Monday', label: 'Mon' },
    { name: 'Tuesday', label: 'Tue' },
    { name: 'Wednesday', label: 'Wed' },
    { name: 'Thursday', label: 'Thu' },
    { name: 'Friday', label: 'Fri' },
    { name: 'Saturday', label: 'Sat' },
    { name: 'Sunday', label: 'Sun' }
  ];

  const handleAutoPlan = async () => {
    if (!user) return;
    setIsAutoPlanning(true);
    try {
      const shuffled = fisherYatesShuffle(seedRecipesData as any[]);
      const selectedRecipes = shuffled.slice(0, 7);

      const weekMeals = meals.filter(meal => {
        const mealDate = new Date(meal.date);
        return mealDate >= weekStart && mealDate <= weekEnd;
      });
      for (const meal of weekMeals) {
        await deleteDoc(doc(db, 'meals', meal.id));
      }

      for (let i = 0; i < 7; i++) {
        const recipe = selectedRecipes[i];
        const mealDate = new Date(weekStart);
        mealDate.setDate(mealDate.getDate() + i);
        mealDate.setHours(18, 0, 0, 0);

        await addDoc(collection(db, 'meals'), {
          uid: user.uid,
          date: mealDate.toISOString(),
          type: 'dinner',
          recipeId: recipe.id || `recipe-${i}`,
          recipeTitle: recipe.title,
          recipeImage: recipe.image || 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80',
          prepTime: recipe.prepTime || 30,
          calories: recipe.calories || 500,
          estimatedCost: recipe.estimatedCost || 12,
          ingredients: recipe.ingredients || []
        });
      }
    } catch (error) {
      console.error("Auto plan failed", error);
    } finally {
      setIsAutoPlanning(false);
    }
  };

  const handleCheckPantryAndAddGroceries = async () => {
    if (!user) return;
    setIsCrossReferencing(true);
    try {
      const weekMeals = meals.filter(meal => {
        const mealDate = new Date(meal.date);
        return mealDate >= weekStart && mealDate <= weekEnd;
      });

      const allIngredients: { name: string; amount: number; unit: string }[] = [];
      weekMeals.forEach(meal => {
        const ingredients = meal.ingredients || [];
        const seedMatch = (seedRecipesData as any[]).find(
          r => r.id === meal.recipeId || (meal.recipeTitle && r.title.toLowerCase() === meal.recipeTitle.toLowerCase())
        );
        const listToUse = ingredients.length > 0 ? ingredients : (seedMatch?.ingredients || []);
        listToUse.forEach((ing: any) => {
          if (ing && ing.name) {
            allIngredients.push({
              name: ing.name.trim(),
              amount: Number(ing.amount) || 1,
              unit: ing.unit || 'unit'
            });
          }
        });
      });

      const pantryItemNames = new Set<string>(
        inventory
          .filter(i => !i.needToBuy)
          .map(i => i.name.toLowerCase().trim())
      );

      const missingIngredients = allIngredients.filter(ing => {
        const normName = ing.name.toLowerCase().trim();
        const exists = Array.from(pantryItemNames).some(pName => pName.includes(normName) || normName.includes(pName));
        return !exists;
      });

      const batch = writeBatch(db);
      let addedCount = 0;
      for (const ing of missingIngredients) {
        const existingShoppingItem = inventory.find(i => i.needToBuy && i.name.toLowerCase().trim() === ing.name.toLowerCase().trim());
        if (!existingShoppingItem) {
          const docRef = doc(collection(db, 'inventory'));
          batch.set(docRef, {
            uid: user.uid,
            name: ing.name,
            quantity: ing.amount,
            unit: ing.unit,
            category: 'Other things',
            price: 0,
            needToBuy: true,
            lowStockThreshold: 0
          });
          addedCount++;
        }
      }
      if (addedCount > 0) {
        await batch.commit();
      }
      alert(`Cross-referenced pantry! Added ${addedCount} missing ingredient(s) to your Grocery List.`);
    } catch (error) {
      console.error("Failed to cross-reference pantry", error);
      alert("Failed to cross-reference pantry. Please try again.");
    } finally {
      setIsCrossReferencing(false);
    }
  };

  const handleClearWeek = () => {
    if (!user) return;
    setConfirmAction({
      title: 'Clear Week',
      message: 'Are you sure you want to clear all meals for this week?',
      action: async () => {
        setIsAutoPlanning(true);
        try {
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

  const handleDeleteMeal = (mealId: string) => {
    if (!user) return;
    setConfirmAction({
      title: 'Remove Meal',
      message: 'Are you sure you want to remove this meal?',
      action: async () => {
        try {
          await deleteDoc(doc(db, 'meals', mealId));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `meals/${mealId}`);
        }
      }
    });
  };

  const handleAddCustomMeal = async (e: React.FormEvent, targetDate: Date) => {
    e.preventDefault();
    if (!user || !customMealTitle.trim()) return;

    try {
      targetDate.setHours(18, 0, 0, 0);
      await addDoc(collection(db, 'meals'), {
        uid: user.uid,
        date: targetDate.toISOString(),
        type: 'dinner',
        recipeId: `custom-${Date.now()}`,
        recipeTitle: customMealTitle.trim(),
        recipeImage: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80',
        prepTime: 30,
        calories: 500,
        estimatedCost: 10,
        ingredients: []
      });
      setCustomMealTitle('');
      setNewMealModalDay(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'meals');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 px-4 sm:px-6 lg:px-8 py-8 bg-[#fbf7f2] min-h-screen text-[#332922]">
      {/* Hand-Drawn Title Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b-2 border-[#d4a373]/30 pb-6">
        <div className="flex items-center gap-4">
          <div className="text-4xl bg-[#f4eee6] p-3 rounded-2xl shadow-inner border border-[#d4a373]/40">
            📝
          </div>
          <div>
            <h1 className="text-5xl font-['Caveat'] font-bold text-[#3a2e26] tracking-wide">
              Weekly Meal Plan
            </h1>
            <p className="text-sm font-['Caveat'] text-[#786c62] tracking-wider text-lg">
              Week {weekNumber} • {monthNames[weekStart.getMonth()]} {weekStart.getDate()} – {weekEnd.getDate()}, {weekEnd.getFullYear()}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button 
            onClick={handleCheckPantryAndAddGroceries}
            disabled={isCrossReferencing}
            className="px-4 py-2.5 bg-[#8c6d53] text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-[#735742] transition-all flex items-center gap-2 disabled:opacity-50 shadow"
            title="Cross-reference ingredients with pantry and add missing items to grocery list"
          >
            <span className="material-symbols-outlined text-sm">{isCrossReferencing ? 'sync' : 'playlist_add_check'}</span>
            {isCrossReferencing ? 'Checking...' : 'Check Pantry & Add Missing'}
          </button>
          <button 
            onClick={handleClearWeek}
            className="px-4 py-2 bg-[#f4eee6] text-[#786c62] border border-[#d4a373]/40 rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-[#ebdccc] transition-all flex items-center gap-1.5 shadow-2xs"
          >
            <span className="material-symbols-outlined text-sm">delete_sweep</span>
            Clear Week
          </button>
          <button 
            onClick={handleAutoPlan}
            disabled={isAutoPlanning}
            className="px-5 py-2.5 bg-[#d4a373] text-white rounded-xl text-xs font-bold uppercase tracking-widest hover:bg-[#bc8a5f] transition-all flex items-center gap-2 disabled:opacity-50 shadow-sm"
          >
            <span className="material-symbols-outlined text-sm">{isAutoPlanning ? 'sync' : 'auto_awesome'}</span>
            {isAutoPlanning ? 'Planning...' : 'Auto-Plan Week'}
          </button>
          <div className="flex gap-1 bg-[#f4eee6] p-1 rounded-xl border border-[#d4a373]/40">
            <button onClick={() => navigateWeek(-1)} className="p-2 rounded-lg bg-white shadow-xs text-[#3a2e26] hover:bg-[#fcfaf7]">
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </button>
            <button onClick={() => navigateWeek(1)} className="p-2 rounded-lg bg-white shadow-xs text-[#3a2e26] hover:bg-[#fcfaf7]">
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
        </div>
      </div>

      {/* 7 Lined Note Paper Cards Grid (Inspired by Template) with Lifted Shadows */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 pb-24">
        {days.map((dayObj, idx) => {
          const dayDate = new Date(weekStart);
          dayDate.setDate(dayDate.getDate() + idx);
          
          const dayMeals = meals.filter(meal => {
            const mDate = new Date(meal.date);
            return mDate.toDateString() === dayDate.toDateString();
          });

          return (
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              key={dayObj.name}
              className="bg-[#fffdfa] rounded-2xl border-2 border-[#d4a373]/65 shadow-xl hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 overflow-hidden flex flex-col min-h-[380px] relative"
            >
              {/* Lined Note Paper Header Box */}
              <div className="bg-[#f4eee6] px-4 py-3 border-b-2 border-[#d4a373]/40 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 rounded-full border border-[#d4a373] flex items-center justify-center text-[10px] font-bold text-[#8c6d53] bg-white">
                    ⊗
                  </div>
                  <h3 className="font-['Caveat'] text-2xl font-bold text-[#3a2e26] tracking-wide">
                    {dayObj.name}
                  </h3>
                </div>
                <span className="text-xs font-mono font-bold text-[#786c62] bg-white px-2 py-0.5 rounded border border-[#d4a373]/40 shadow-2xs">
                  {dayDate.getMonth() + 1}/{dayDate.getDate()}
                </span>
              </div>

              {/* Lined Note Paper Content Area */}
              <div className="p-4 flex-1 flex flex-col justify-between bg-[linear-gradient(to_bottom,transparent_31px,#e8dfd3_32px)] bg-[size:100%_32px]">
                <div className="space-y-4 pt-1">
                  {dayMeals.length > 0 ? (
                    dayMeals.map((meal) => {
                      const seedMatch = (seedRecipesData as any[]).find(
                        r => r.id === meal.recipeId || (meal.recipeTitle && r.title.toLowerCase() === meal.recipeTitle.toLowerCase())
                      );
                      const ingredientsList = (meal.ingredients && meal.ingredients.length > 0) ? meal.ingredients : (seedMatch?.ingredients || []);

                      return (
                        <div 
                          key={meal.id}
                          className="group relative bg-[#fffdfa]/90 p-2.5 rounded-xl border border-[#d4a373]/30 shadow-2xs hover:bg-white transition-all"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <span 
                                onClick={() => handleOpenRecipeModal(meal)}
                                className="font-['Caveat'] text-2xl font-bold text-[#3a2e26] block truncate cursor-pointer hover:text-[#bc8a5f] transition-colors"
                              >
                                {meal.recipeTitle}
                              </span>
                            </div>
                            <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleOpenRecipeModal(meal)}
                                className="text-[10px] font-bold text-[#8c6d53] px-1.5 py-0.5 bg-[#f4eee6] rounded hover:bg-[#ebdccc]"
                                title="View Full Recipe"
                              >
                                View
                              </button>
                              <button
                                onClick={() => handleDeleteMeal(meal.id)}
                                className="text-red-500 hover:text-red-700 p-1"
                                title="Remove"
                              >
                                <span className="material-symbols-outlined text-xs">close</span>
                              </button>
                            </div>
                          </div>

                          {/* Printed Ingredients on Lined Card */}
                          {ingredientsList.length > 0 && (
                            <div className="mt-2 pt-1 border-t border-[#f4eee6] font-['Caveat'] text-lg text-[#786c62] leading-snug">
                              <span className="font-bold text-[#8c6d53] text-sm block mb-0.5">Ingredients:</span>
                              <ul className="space-y-0.5 pl-1">
                                {ingredientsList.map((i: any, iIdx: number) => (
                                  <li key={iIdx} className="flex items-center justify-between text-base">
                                    <span>• {i.name}</span>
                                    {i.amount && <span className="text-xs font-mono text-[#a09384] ml-2">{i.amount} {i.unit || ''}</span>}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="py-6 text-center">
                      <p className="font-['Caveat'] text-xl text-[#b0a496] italic">No meals added yet...</p>
                    </div>
                  )}
                </div>

                <div className="pt-4 mt-auto border-t border-[#e8dfd3]">
                  <button 
                    onClick={() => setNewMealModalDay(dayDate.toISOString())}
                    className="w-full py-2 bg-[#f4eee6]/90 hover:bg-[#f4eee6] text-[#786c62] hover:text-[#3a2e26] rounded-xl text-xs font-['Caveat'] text-xl font-bold tracking-wide border border-[#d4a373]/40 transition-colors shadow-2xs flex items-center justify-center gap-1"
                  >
                    <span>+ Add Meal</span>
                  </button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Add Custom Meal Modal */}
      <AnimatePresence>
        {newMealModalDay && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setNewMealModalDay(null)}
              className="absolute inset-0 bg-[#3a2e26]/40 backdrop-blur-xs"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-md bg-[#fffdfa] border-2 border-[#d4a373] rounded-2xl p-6 shadow-2xl"
            >
              <h3 className="font-['Caveat'] text-3xl font-bold text-[#3a2e26] mb-4">Add Meal for {new Date(newMealModalDay).toLocaleDateString('en-US', { weekday: 'long' })}</h3>
              <form onSubmit={(e) => handleAddCustomMeal(e, new Date(newMealModalDay))} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold uppercase tracking-widest text-[#786c62]">Meal / Recipe Title</label>
                  <input 
                    required
                    autoFocus
                    value={customMealTitle}
                    onChange={e => setCustomMealTitle(e.target.value)}
                    className="w-full bg-[#fdfbf7] border border-[#d4a373]/50 rounded-xl py-2.5 px-3 font-['Caveat'] text-2xl text-[#3a2e26] focus:ring-2 focus:ring-[#d4a373] outline-none"
                    placeholder="e.g. Garlic Butter Steak & Veggies"
                  />
                </div>
                <div className="pt-2 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setNewMealModalDay(null)}
                    className="flex-1 py-2.5 rounded-xl border border-[#d4a373]/50 text-[#786c62] font-bold uppercase tracking-widest text-xs hover:bg-[#fdfbf7]"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-[#d4a373] text-white font-bold uppercase tracking-widest text-xs shadow hover:bg-[#bc8a5f]"
                  >
                    Add Meal
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Recipe Modal */}
      <AnimatePresence>
        {selectedRecipe && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedRecipe(null)}
              className="absolute inset-0 bg-[#3a2e26]/40 backdrop-blur-xs"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-2xl bg-[#fffdfa] border-2 border-[#d4a373] rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-start mb-4">
                <h2 className="font-['Caveat'] text-4xl font-bold text-[#3a2e26]">{selectedRecipe.title}</h2>
                <button 
                  onClick={() => setSelectedRecipe(null)}
                  className="w-8 h-8 rounded-full bg-[#f4eee6] text-[#786c62] flex items-center justify-center hover:bg-[#ebdccc]"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>

              <div className="space-y-4">
                <p className="text-sm text-[#786c62] leading-relaxed font-body">{selectedRecipe.description}</p>
                <div className="flex gap-4 text-xs font-mono text-[#786c62] bg-[#f4eee6]/60 p-3 rounded-xl border border-[#d4a373]/40">
                  <span>⏱️ Prep: {selectedRecipe.prepTime} mins</span>
                  <span>🔥 Calories: {selectedRecipe.calories} kcal</span>
                  <span>💰 Est. Cost: ${(selectedRecipe.estimatedCost || 10).toFixed(2)}</span>
                </div>

                <div>
                  <h3 className="font-bold text-xs uppercase tracking-widest text-[#3a2e26] mb-2">Ingredients</h3>
                  <ul className="space-y-1 text-xs text-[#786c62]">
                    {selectedRecipe.ingredients.map((ing, i) => (
                      <li key={i} className="flex justify-between border-b border-[#e8dfd3] py-1">
                        <span>{ing.name}</span>
                        <span className="font-mono">{ing.amount} {ing.unit}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="font-bold text-xs uppercase tracking-widest text-[#3a2e26] mb-2">Instructions</h3>
                  <ol className="space-y-2 text-xs text-[#786c62] list-decimal pl-4">
                    {selectedRecipe.instructions.map((step, i) => (
                      <li key={i} className="leading-relaxed">{step}</li>
                    ))}
                  </ol>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Dialog */}
      <AnimatePresence>
        {confirmAction && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmAction(null)}
              className="absolute inset-0 bg-[#3a2e26]/40 backdrop-blur-xs"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-[#fffdfa] border-2 border-[#d4a373] rounded-2xl p-6 shadow-2xl space-y-4 text-center"
            >
              <h3 className="font-['Caveat'] text-3xl font-bold text-[#3a2e26]">{confirmAction.title}</h3>
              <p className="text-xs text-[#786c62]">{confirmAction.message}</p>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="flex-1 py-2.5 rounded-xl border border-[#d4a373]/50 text-[#786c62] font-bold uppercase tracking-widest text-xs hover:bg-[#fdfbf7]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { confirmAction.action(); setConfirmAction(null); }}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 text-white font-bold uppercase tracking-widest text-xs shadow hover:bg-red-700"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
