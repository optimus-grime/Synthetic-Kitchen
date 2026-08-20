import React, { useState, useEffect } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc, addDoc, getDocs, deleteDoc, writeBatch } from 'firebase/firestore';
import { Recipe, InventoryItem } from '../types';
import { useAuthState } from 'react-firebase-hooks/auth';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import seedRecipesData from '../data/seedRecipes.json';

const seedRecipes: Recipe[] = (seedRecipesData as any[]).map(r => ({ ...r, uid: r.uid || 'seed' }));

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}



export default function RecipesPage() {
  const [user] = useAuthState(auth);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('All');
  const [maxPrepTime, setMaxPrepTime] = useState<number>(120);
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<string[]>([]);
  const [planningRecipe, setPlanningRecipe] = useState<Recipe | null>(null);
  const [planDate, setPlanDate] = useState(new Date().toISOString().split('T')[0]);
  const [planType, setPlanType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('dinner');
  const [isPlanning, setIsPlanning] = useState(false);
  const [isAddRecipeOpen, setIsAddRecipeOpen] = useState(false);
  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null);
  const [isCalculatingCost, setIsCalculatingCost] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{title: string, message: string, action: () => void} | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  
  const [newRecipe, setNewRecipe] = useState({
    title: '',
    description: '',
    prepTime: 30,
    calories: 500,
    estimatedCost: 5.00,
    image: '',
    ingredientsText: '',
    instructionsText: '',
    tags: 'Healthy, Quick'
  });

  const calculateEstimatedCost = async () => {
    if (!user || !newRecipe.ingredientsText.trim()) return;
    setIsCalculatingCost(true);
    try {
      const q = query(collection(db, 'inventory'), where('uid', '==', user.uid));
      const snapshot = await getDocs(q);
      const inventory = snapshot.docs.map(doc => doc.data() as InventoryItem);

      const parsedIngredients = newRecipe.ingredientsText.split('\n').filter(i => i.trim()).map(line => {
        const match = line.trim().match(/^([\d.]+)\s*([a-zA-Z]+)?\s+(.+)$/);
        if (match) {
          return { amount: Number(match[1]), unit: match[2] || 'unit', name: match[3].toLowerCase() };
        }
        return { amount: 1, unit: 'unit', name: line.trim().toLowerCase() };
      });

      let totalCost = 0;

      for (const ing of parsedIngredients) {
        const match = inventory.find(item => 
          item.name.toLowerCase().includes(ing.name) || 
          ing.name.includes(item.name.toLowerCase())
        );
        
        if (match && match.price && match.quantity > 0) {
          const costPerUnit = match.price / match.quantity;
          
          let adjustedAmount = ing.amount;
          const invUnit = (match.unit || '').toLowerCase();
          const recUnit = (ing.unit || '').toLowerCase();
          
          if (recUnit === 'g' && invUnit === 'kg') adjustedAmount = ing.amount / 1000;
          else if (recUnit === 'kg' && invUnit === 'g') adjustedAmount = ing.amount * 1000;
          else if (recUnit === 'ml' && invUnit === 'l') adjustedAmount = ing.amount / 1000;
          else if (recUnit === 'l' && invUnit === 'ml') adjustedAmount = ing.amount * 1000;

          totalCost += costPerUnit * adjustedAmount;
        }
      }

      if (totalCost > 0) {
        setNewRecipe(prev => ({ ...prev, estimatedCost: Number(totalCost.toFixed(2)) }));
      }
    } catch (error) {
      console.error("Failed to calculate cost", error);
    } finally {
      setIsCalculatingCost(false);
    }
  };

  const fetchSpoonacularRecipes = async (queryTerm = '') => {
    setLoading(true);
    setApiError(null);
    try {
      const res = await fetch('/api/recipes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryTerm })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to generate recipes from Gemini');
      }
      const rawList = await res.json();
      const formatted = (Array.isArray(rawList) ? rawList : []).map((r: any, idx: number) => ({
        id: `gemini-${Date.now()}-${idx}`,
        title: r.title || 'Comfort Meal',
        description: r.description || 'Delicious home-style comfort food recipe.',
        image: r.image || 'https://images.unsplash.com/photo-1544025162-d76694265947?w=600&auto=format&fit=crop&q=80',
        prepTime: r.prepTime || 30,
        calories: r.calories || 450,
        estimatedCost: r.estimatedCost || 8.00,
        ingredients: r.ingredients || [],
        instructions: r.instructions || ['Prepare and cook as directed.'],
        tags: r.tags || ['Comfort Food', 'Western'],
        isFavorite: false,
        uid: 'gemini'
      }));

      let userRecipes: Recipe[] = [];
      if (user) {
        try {
          const q = query(collection(db, 'recipes'), where('uid', '==', user.uid));
          const snap = await getDocs(q);
          userRecipes = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Recipe));
        } catch (e) {
          console.error("Error loading user recipes", e);
        }
      }

      setRecipes([...userRecipes, ...formatted]);
    } catch (err: any) {
      console.error("Gemini recipe fetch error:", err);
      setApiError(err.message || 'Service unavailable. Showing offline seed recipes.');
      let userRecipes: Recipe[] = [];
      if (user) {
        try {
          const q = query(collection(db, 'recipes'), where('uid', '==', user.uid));
          const snap = await getDocs(q);
          userRecipes = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Recipe));
        } catch (e) {}
      }
      const combined = [...userRecipes];
      for (const seed of seedRecipes) {
        if (!combined.some(r => r.id === seed.id || r.title.toLowerCase() === seed.title.toLowerCase())) {
          combined.push(seed);
        }
      }
      setRecipes(combined);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSpoonacularRecipes();
  }, [user]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        fetchSpoonacularRecipes(searchQuery);
      } else if (searchQuery.trim().length === 0) {
        fetchSpoonacularRecipes();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const toggleFavorite = async (recipe: Recipe) => {
    if (!user) return;
    try {
      if (recipe.uid === 'mock' || recipe.uid === 'seed' || recipe.id.startsWith('seed-')) {
        // For seed/mock recipes, just update local state
        setRecipes(prev => prev.map(r => 
          r.id === recipe.id ? { ...r, isFavorite: !r.isFavorite } : r
        ));
        return;
      }
      await updateDoc(doc(db, 'recipes', recipe.id), {
        isFavorite: !recipe.isFavorite
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `recipes/${recipe.id}`);
    }
  };

  const handlePlanMeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !planningRecipe) return;

    setIsPlanning(true);
    try {
      await addDoc(collection(db, 'meals'), {
        uid: user.uid,
        recipeId: planningRecipe.id,
        recipeTitle: planningRecipe.title,
        recipeImage: planningRecipe.image,
        date: new Date(planDate).toISOString(),
        type: planType,
        calories: planningRecipe.calories || 0,
        estimatedCost: planningRecipe.estimatedCost || 0,
        prepTime: planningRecipe.prepTime || 0,
        ingredients: planningRecipe.ingredients || []
      });
      setPlanningRecipe(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'meals');
    } finally {
      setIsPlanning(false);
    }
  };

  const handleAddRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      const ingredients = newRecipe.ingredientsText.split('\n').filter(i => i.trim()).map(line => {
        // Simple parser: "100 g Chicken" -> { amount: 100, unit: 'g', name: 'Chicken' }
        const match = line.trim().match(/^([\d.]+)\s*([a-zA-Z]+)?\s+(.+)$/);
        if (match) {
          return { amount: Number(match[1]), unit: match[2] || 'unit', name: match[3] };
        }
        return { amount: 1, unit: 'unit', name: line.trim() };
      });

      const instructions = newRecipe.instructionsText.split('\n').filter(i => i.trim());
      const tags = newRecipe.tags.split(',').map(t => t.trim()).filter(t => t);

      await addDoc(collection(db, 'recipes'), {
        uid: user.uid,
        title: newRecipe.title,
        description: newRecipe.description,
        prepTime: Number(newRecipe.prepTime),
        calories: Number(newRecipe.calories),
        estimatedCost: Number(newRecipe.estimatedCost),
        image: newRecipe.image || `https://loremflickr.com/800/600/${newRecipe.title.split(' ')[0]}`,
        ingredients,
        instructions,
        tags,
        isFavorite: false
      });

      setIsAddRecipeOpen(false);
      setNewRecipe({ title: '', description: '', prepTime: 30, calories: 500, estimatedCost: 5.00, image: '', ingredientsText: '', instructionsText: '', tags: 'Healthy, Quick' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'recipes');
    }
  };

  const handleDeleteRecipe = (recipeId: string) => {
    if (!user) return;
    setConfirmAction({
      title: 'Delete Recipe',
      message: 'Are you sure you want to delete this recipe? This cannot be undone.',
      action: async () => {
        try {
          if (!recipeId.startsWith('seed-')) {
            await deleteDoc(doc(db, 'recipes', recipeId));
          }
          setRecipes(prev => prev.filter(r => r.id !== recipeId));
          setSelectedRecipeIds(prev => prev.filter(id => id !== recipeId));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `recipes/${recipeId}`);
        }
      }
    });
  };

  const handleDeleteSelected = () => {
    if (!user || selectedRecipeIds.length === 0) return;
    setConfirmAction({
      title: 'Delete Selected Recipes',
      message: `Are you sure you want to delete ${selectedRecipeIds.length} recipes? This cannot be undone.`,
      action: async () => {
        try {
          const batch = writeBatch(db);
          let count = 0;
          for (const id of selectedRecipeIds) {
            if (!id.startsWith('seed-')) {
              batch.delete(doc(db, 'recipes', id));
              count++;
              if (count % 400 === 0) {
                await batch.commit();
              }
            }
          }
          if (count > 0 && count % 400 !== 0) {
            await batch.commit();
          }
          setRecipes(prev => prev.filter(r => !selectedRecipeIds.includes(r.id)));
          setSelectedRecipeIds([]);
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `recipes/batch`);
        }
      }
    });
  };

  const filteredRecipes = recipes.filter(recipe => {
    const searchLower = searchQuery.toLowerCase();
    const matchesSearch = 
      recipe.title.toLowerCase().includes(searchLower) || 
      recipe.description.toLowerCase().includes(searchLower) ||
      (recipe.ingredients && recipe.ingredients.some((ing: any) => ing.name?.toLowerCase().includes(searchLower)));
      
    const matchesFilter = activeFilter === 'All' || 
                         (recipe.tags && recipe.tags.includes(activeFilter)) ||
                         (activeFilter === 'Quick' && recipe.prepTime <= 20) ||
                         (activeFilter === 'Healthy' && recipe.calories && recipe.calories < 500);
                         
    const matchesPrepTime = recipe.prepTime <= maxPrepTime;

    return matchesSearch && matchesFilter && matchesPrepTime;
  });

  const handleSelectAll = () => {
    if (selectedRecipeIds.length === filteredRecipes.length && filteredRecipes.length > 0) {
      setSelectedRecipeIds([]);
    } else {
      setSelectedRecipeIds(filteredRecipes.map(recipe => recipe.id));
    }
  };

  const toggleSelectRecipe = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    setSelectedRecipeIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-10">
      {apiError && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 p-4 rounded-xl flex items-center gap-3 text-sm">
          <span className="material-symbols-outlined flex-shrink-0">warning</span>
          <span>{apiError}</span>
        </div>
      )}
      {/* Search & Filter Section */}
      <section>
        <div className="relative group">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-on-surface-variant">
            <span className="material-symbols-outlined">search</span>
          </div>
          <input 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-surface-container-highest border-none rounded-xl py-4 pl-12 pr-4 font-headline tracking-widest text-sm focus:ring-2 focus:ring-secondary transition-all placeholder:text-on-surface-variant/40" 
            placeholder="Search recipes, keywords, or ingredients..." 
            type="text"
          />
        </div>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mt-6">
          <div className="flex gap-3 overflow-x-auto hide-scrollbar py-2 w-full md:w-auto">
            {['All', 'Quick', 'Healthy', 'High Protein', 'Low Carb'].map((filter) => (
              <button 
                key={filter}
                onClick={() => setActiveFilter(filter)}
                className={cn(
                  "px-6 py-2 rounded-full font-label text-[10px] uppercase tracking-widest flex-shrink-0 transition-all cursor-pointer",
                  activeFilter === filter 
                    ? "bg-primary-container text-on-primary font-extrabold hover:brightness-110" 
                    : "bg-surface-container-high text-on-surface-variant font-bold border border-outline-variant/20 hover:border-primary/50"
                )}
              >
                {filter}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-4 text-xs font-headline font-bold text-on-surface-variant uppercase tracking-widest px-2 w-full md:w-auto">
            <span className="whitespace-nowrap">Max Prep: {maxPrepTime} Min</span>
            <input 
              type="range" 
              min="5" 
              max="120" 
              step="5" 
              value={maxPrepTime} 
              onChange={e => setMaxPrepTime(Number(e.target.value))} 
              className="w-full md:w-32 accent-primary" 
            />
          </div>
        </div>
      </section>

      {/* Bulk Actions */}
      <div className="flex flex-wrap items-center gap-4 justify-end">
        {filteredRecipes.length > 0 && (
          <button 
            onClick={handleSelectAll}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
              selectedRecipeIds.length === filteredRecipes.length && filteredRecipes.length > 0
                ? "bg-primary text-on-primary border-primary"
                : "bg-surface-container-high text-on-surface border-outline-variant/30 hover:bg-surface-container-highest"
            )}
          >
            <span className="material-symbols-outlined text-sm">
              {selectedRecipeIds.length === filteredRecipes.length && filteredRecipes.length > 0 ? 'deselect' : 'select_all'}
            </span>
            <span className="text-[10px] font-headline font-bold uppercase tracking-widest">
              {selectedRecipeIds.length === filteredRecipes.length && filteredRecipes.length > 0 ? 'Deselect All' : 'Select All'}
            </span>
          </button>
        )}
        {selectedRecipeIds.length > 0 && (
          <button 
            onClick={handleDeleteSelected}
            className="flex items-center gap-2 px-4 py-2 bg-error/10 text-error rounded-lg border border-error/20 hover:bg-error/20 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">delete</span>
            <span className="text-[10px] font-headline font-bold uppercase tracking-widest">Delete ({selectedRecipeIds.length})</span>
          </button>
        )}
      </div>

      {/* Bento Recipe Gallery */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {loading ? (
          <div className="col-span-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="aspect-square bg-surface-container rounded-xl animate-pulse"></div>
            ))}
          </div>
        ) : filteredRecipes.length > 0 ? (
          filteredRecipes.map((recipe, i) => (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1 }}
              key={recipe.id}
              className={cn(
                "group relative overflow-hidden rounded-xl border transition-all duration-300 flex flex-col",
                selectedRecipeIds.includes(recipe.id) 
                  ? "bg-primary/5 border-primary/40 shadow-inner" 
                  : "bg-surface-container border-outline-variant/20 hover:border-primary/30"
              )}
            >
              <div className="p-6 flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={(e) => toggleSelectRecipe(recipe.id, e)}
                      className={cn(
                        "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all cursor-pointer",
                        selectedRecipeIds.includes(recipe.id) ? "bg-primary border-primary" : "border-outline-variant"
                      )}
                    >
                      {selectedRecipeIds.includes(recipe.id) && <span className="material-symbols-outlined text-[16px] text-on-primary font-bold">check</span>}
                    </button>
                    <div className="flex items-center gap-1 text-on-surface-variant text-xs bg-surface-container-high px-3 py-1 rounded-full">
                      <span className="material-symbols-outlined text-sm">schedule</span>
                      <span className="font-headline font-bold">{recipe.prepTime} MIN</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleDeleteRecipe(recipe.id)}
                      className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-error transition-all active:scale-90 hover:bg-error/10 cursor-pointer"
                      title="Delete Recipe"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                    <button 
                      onClick={() => toggleFavorite(recipe)}
                      className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-primary transition-all active:scale-90 hover:bg-primary/10 cursor-pointer"
                    >
                      <span className="material-symbols-outlined" style={{ fontVariationSettings: `'FILL' ${recipe.isFavorite ? 1 : 0}` }}>favorite</span>
                    </button>
                  </div>
                </div>
                
                <h2 
                  onClick={() => setViewingRecipe(recipe)}
                  className="font-headline font-bold text-on-surface tracking-tighter leading-tight group-hover:text-primary transition-colors cursor-pointer text-2xl mb-2"
                >
                  {recipe.title}
                </h2>
                <p className="text-sm text-on-surface-variant leading-relaxed font-body line-clamp-3 flex-1">{recipe.description}</p>
                
                <div className="flex gap-2 mt-6">
                  <button 
                    onClick={() => setViewingRecipe(recipe)}
                    className="flex-1 py-3 bg-surface-container-highest text-on-surface rounded-xl font-headline text-xs font-bold uppercase tracking-widest hover:bg-surface-container-high transition-all cursor-pointer"
                  >
                    View
                  </button>
                  <button 
                    onClick={() => setPlanningRecipe(recipe)}
                    className="flex-1 py-3 bg-primary/10 text-primary border border-primary/20 rounded-xl font-headline text-xs font-bold uppercase tracking-widest hover:bg-primary hover:text-on-primary transition-all cursor-pointer"
                  >
                    Plan
                  </button>
                </div>
              </div>
            </motion.div>
          ))
        ) : (
          <div className="col-span-full text-center py-20 bg-surface-container rounded-xl border border-dashed border-outline-variant/30">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-4">menu_book</span>
            <p className="text-on-surface-variant">No recipes found in the database.</p>
          </div>
        )}
      </section>
      {/* Plan Meal Modal */}
      <AnimatePresence>
        {planningRecipe && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setPlanningRecipe(null)}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-surface-container border border-outline-variant/30 rounded-2xl p-8 shadow-2xl"
            >
              <h2 className="font-headline text-2xl font-bold mb-6 tracking-tight">PLAN MEAL</h2>
              <p className="text-on-surface-variant text-sm mb-6 uppercase tracking-widest font-bold">{planningRecipe.title}</p>
              
              <form onSubmit={handlePlanMeal} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Select Date</label>
                  <input 
                    type="date"
                    required
                    value={planDate}
                    onChange={e => setPlanDate(e.target.value)}
                    className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                  />
                </div>
                
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Meal Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['breakfast', 'lunch', 'dinner', 'snack'].map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setPlanType(type as any)}
                        className={cn(
                          "py-2 rounded-lg font-headline text-[10px] font-bold uppercase tracking-widest border transition-all",
                          planType === type 
                            ? "bg-primary text-on-primary border-primary" 
                            : "bg-surface-container-highest text-on-surface-variant border-transparent"
                        )}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-6 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setPlanningRecipe(null)}
                    className="flex-1 py-4 rounded-xl border border-outline-variant text-on-surface font-headline font-bold uppercase tracking-widest text-xs"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isPlanning}
                    className="flex-1 py-4 rounded-xl bg-primary text-on-primary font-headline font-black uppercase tracking-widest text-xs shadow-lg disabled:opacity-50"
                  >
                    {isPlanning ? 'Planning...' : 'Add to Plan'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* View Recipe Modal */}
      <AnimatePresence>
        {viewingRecipe && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setViewingRecipe(null)}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-3xl max-h-full overflow-y-auto hide-scrollbar bg-surface-container border border-outline-variant/30 rounded-3xl shadow-2xl"
            >
              <div className="p-8 relative z-10">
                <div className="flex justify-between items-start mb-8">
                  <div>
                    <div className="flex items-center gap-4 mb-4">
                      <span className="px-3 py-1 bg-primary/20 text-primary text-[10px] font-bold uppercase tracking-widest rounded border border-primary/30 backdrop-blur-sm">
                        {viewingRecipe.prepTime} MIN
                      </span>
                      <span className="px-3 py-1 bg-secondary/20 text-secondary text-[10px] font-bold uppercase tracking-widest rounded border border-secondary/30 backdrop-blur-sm">
                        ${(viewingRecipe.estimatedCost || 0).toFixed(2)} / MEAL
                      </span>
                    </div>
                    <h2 className="font-headline text-4xl font-black tracking-tight">{viewingRecipe.title}</h2>
                  </div>
                  <button 
                    onClick={() => setViewingRecipe(null)}
                    className="w-10 h-10 rounded-full bg-surface-container-highest flex items-center justify-center text-on-surface hover:text-primary transition-colors cursor-pointer"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>
                
                <p className="text-on-surface-variant leading-relaxed mb-8 text-lg">{viewingRecipe.description}</p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                  <div>
                    <h3 className="font-headline text-xl font-bold mb-4 flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary">kitchen</span>
                      Ingredients
                    </h3>
                    <ul className="space-y-3">
                      {viewingRecipe.ingredients?.map((ing, idx) => (
                        <li key={idx} className="flex items-center justify-between border-b border-outline-variant/20 pb-2">
                          <span className="text-on-surface">{ing.name}</span>
                          <span className="text-on-surface-variant font-bold text-sm">{ing.amount} {ing.unit}</span>
                        </li>
                      ))}
                      {(!viewingRecipe.ingredients || viewingRecipe.ingredients.length === 0) && (
                        <p className="text-on-surface-variant text-sm italic">No ingredients listed.</p>
                      )}
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-headline text-xl font-bold mb-4 flex items-center gap-2">
                      <span className="material-symbols-outlined text-secondary">restaurant_menu</span>
                      Instructions
                    </h3>
                    <ol className="space-y-4">
                      {viewingRecipe.instructions?.map((inst, idx) => (
                        <li key={idx} className="flex gap-4">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-surface-container-highest text-on-surface flex items-center justify-center font-headline font-bold text-xs">
                            {idx + 1}
                          </span>
                          <span className="text-on-surface-variant leading-relaxed">{inst}</span>
                        </li>
                      ))}
                      {(!viewingRecipe.instructions || viewingRecipe.instructions.length === 0) && (
                        <p className="text-on-surface-variant text-sm italic">No instructions listed.</p>
                      )}
                    </ol>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Recipe Modal */}
      <AnimatePresence>
        {isAddRecipeOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddRecipeOpen(false)}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl max-h-full overflow-y-auto hide-scrollbar bg-surface-container border border-outline-variant/30 rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-headline text-3xl font-black tracking-tight">CREATE RECIPE</h2>
                <button onClick={() => setIsAddRecipeOpen(false)} className="text-on-surface-variant hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              
              <form onSubmit={handleAddRecipe} className="space-y-6">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Recipe Title</label>
                  <input 
                    required
                    value={newRecipe.title}
                    onChange={e => setNewRecipe({...newRecipe, title: e.target.value})}
                    className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                    placeholder="E.g. Classic Spaghetti Bolognese"
                  />
                </div>
                
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Description</label>
                  <textarea 
                    required
                    value={newRecipe.description}
                    onChange={e => setNewRecipe({...newRecipe, description: e.target.value})}
                    className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary min-h-[80px]"
                    placeholder="A brief description of the meal..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Prep Time (Mins)</label>
                    <input 
                      type="number"
                      required
                      value={newRecipe.prepTime}
                      onChange={e => setNewRecipe({...newRecipe, prepTime: Number(e.target.value)})}
                      className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Est. Cost ($)</label>
                      <button 
                        type="button" 
                        onClick={calculateEstimatedCost}
                        disabled={isCalculatingCost || !newRecipe.ingredientsText.trim()}
                        className="text-[10px] uppercase tracking-widest font-bold text-primary hover:text-primary-fixed transition-colors disabled:opacity-50"
                      >
                        {isCalculatingCost ? 'Calculating...' : 'Auto-Calc'}
                      </button>
                    </div>
                    <input 
                      type="number"
                      step="0.01"
                      required
                      value={newRecipe.estimatedCost}
                      onChange={e => setNewRecipe({...newRecipe, estimatedCost: Number(e.target.value)})}
                      className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Ingredients (One per line: "Amount Unit Name")</label>
                  <textarea 
                    required
                    value={newRecipe.ingredientsText}
                    onChange={e => setNewRecipe({...newRecipe, ingredientsText: e.target.value})}
                    className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary min-h-[120px]"
                    placeholder="500 g Ground Beef&#10;1 jar Tomato Sauce&#10;200 g Spaghetti"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Instructions (One step per line)</label>
                  <textarea 
                    required
                    value={newRecipe.instructionsText}
                    onChange={e => setNewRecipe({...newRecipe, instructionsText: e.target.value})}
                    className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary min-h-[120px]"
                    placeholder="Boil water for pasta.&#10;Brown the beef in a pan.&#10;Add sauce and simmer."
                  />
                </div>

                <div className="pt-4">
                  <button 
                    type="submit"
                    className="w-full py-4 rounded-xl bg-primary text-on-primary font-headline font-black uppercase tracking-widest text-xs shadow-lg hover:brightness-110 transition-all"
                  >
                    Save Recipe to Database
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* FAB for Adding Recipe */}
      <button 
        onClick={() => setIsAddRecipeOpen(true)}
        className="fixed bottom-24 right-6 w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary-container text-on-primary shadow-[0_0_30px_rgba(161,255,194,0.3)] flex items-center justify-center active:scale-90 transition-transform z-[60]"
      >
        <span className="material-symbols-outlined text-3xl">add</span>
      </button>

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
