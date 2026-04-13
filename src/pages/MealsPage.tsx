import React, { useState, useEffect, useMemo } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, orderBy, addDoc } from 'firebase/firestore';
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
      const newRecipes = await generateBudgetMealPlan();
      
      for (let i = 0; i < newRecipes.length; i++) {
        const recipeData = newRecipes[i];
        
        // Add Recipe
        const recipeRef = await addDoc(collection(db, 'recipes'), {
          uid: user.uid,
          title: recipeData.title,
          description: recipeData.description,
          prepTime: recipeData.prepTime,
          calories: recipeData.calories,
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
        await addDoc(collection(db, 'grocery'), {
          ...item,
          completed: false,
          uid: user.uid
        });
      }
      navigate('/grocery');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'grocery');
    }
  };

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
                      <div className="flex items-center gap-2 mb-2">
                        <span className="material-symbols-outlined text-primary text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                          {meal.type === 'breakfast' ? 'wb_twilight' : meal.type === 'lunch' ? 'light_mode' : 'dark_mode'}
                        </span>
                        <span className="font-label text-[10px] uppercase tracking-[0.2em] text-primary font-bold">
                          {meal.type} • {new Date(meal.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <h3 className="font-headline text-2xl font-bold mb-2">{meal.recipeTitle}</h3>
                      <p className="text-on-surface-variant text-sm leading-relaxed max-w-md">Scheduled meal for your NEON PANTRY nutrition plan.</p>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex gap-4">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-secondary">{meal.calories || 0} CAL</span>
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
              Daily Macros
              <span className="material-symbols-outlined text-secondary">analytics</span>
            </h4>
            <div className="space-y-6">
              <MacroBar label="Protein" current={112} target={140} color="bg-primary" />
              <MacroBar label="Carbs" current={210} target={250} color="bg-secondary" />
              <MacroBar label="Fats" current={54} target={70} color="bg-tertiary" />
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
    </div>
  );
}

function MacroBar({ label, current, target, color }: { label: string, current: number, target: number, color: string }) {
  const percentage = Math.min((current / target) * 100, 100);
  return (
    <div>
      <div className="flex justify-between text-[10px] uppercase tracking-widest font-bold mb-2">
        <span>{label}</span>
        <span className="text-primary">{current}g / {target}g</span>
      </div>
      <div className="h-1.5 w-full bg-background rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-1000", color)} style={{ width: `${percentage}%` }}></div>
      </div>
    </div>
  );
}
