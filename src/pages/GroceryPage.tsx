import React, { useState, useEffect } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch, getDocs } from 'firebase/firestore';
import { GroceryItem, Meal, InventoryItem } from '../types';
import { useAuthState } from 'react-firebase-hooks/auth';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Link, useNavigate } from 'react-router-dom';
import { consolidateGroceries } from '../services/geminiService';
import { normalizeIngredientName, aggregateIngredients } from '../utils/ingredientNormalizer';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function GroceryPage() {
  const [user] = useAuthState(auth);
  const navigate = useNavigate();
  const [items, setItems] = useState<GroceryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newItemName, setNewItemName] = useState('');

  const [isSyncing, setIsSyncing] = useState(false);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditName, setInlineEditName] = useState<string>('');

  const handleStartInlineEdit = (item: GroceryItem) => {
    setInlineEditId(item.id);
    setInlineEditName(item.name);
  };

  const handleSaveInlineEdit = async (item: GroceryItem) => {
    if (!inlineEditName.trim() || !user) {
      setInlineEditId(null);
      return;
    }

    const normName = normalizeIngredientName(inlineEditName.trim());

    // Check if another item in grocery has this same normalized name and completed state
    const existingOther = items.find(
      i => i.id !== item.id && 
           normalizeIngredientName(i.name) === normName && 
           i.completed === item.completed
    );

    try {
      if (existingOther) {
        // Merge quantities into existingOther, delete item
        const newAmount = (existingOther.amount || 1) + (item.amount || 1);
        await updateDoc(doc(db, 'grocery', existingOther.id), {
          amount: newAmount,
          unit: existingOther.unit || item.unit || 'unit'
        });
        await deleteDoc(doc(db, 'grocery', item.id));
      } else {
        await updateDoc(doc(db, 'grocery', item.id), {
          name: normName
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `grocery/${item.id}`);
    } finally {
      setInlineEditId(null);
    }
  };

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'grocery'),
      where('uid', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GroceryItem));
      setItems(itemsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'grocery');
    });

    return () => unsubscribe();
  }, [user]);

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newItemName.trim()) return;

    const normalizedName = normalizeIngredientName(newItemName.trim());

    try {
      const existing = items.find(i => normalizeIngredientName(i.name) === normalizedName && !i.completed);
      if (existing) {
        await updateDoc(doc(db, 'grocery', existing.id), {
          amount: (existing.amount || 1) + 1
        });
      } else {
        await addDoc(collection(db, 'grocery'), {
          name: normalizedName,
          amount: 1,
          unit: 'unit',
          completed: false,
          uid: user.uid,
          category: 'General'
        });
      }
      setNewItemName('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'grocery');
    }
  };

  const toggleComplete = async (item: GroceryItem) => {
    try {
      await updateDoc(doc(db, 'grocery', item.id), {
        completed: !item.completed
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `grocery/${item.id}`);
    }
  };

  const deleteItem = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'grocery', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `grocery/${id}`);
    }
  };

  const handleSelectAll = async () => {
    if (!user || items.length === 0) return;
    const allCompleted = items.every(i => i.completed);
    
    try {
      const batch = writeBatch(db);
      items.forEach(item => {
        batch.update(doc(db, 'grocery', item.id), {
          completed: !allCompleted
        });
      });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'grocery/batch');
    }
  };

  const handleClearCompleted = async () => {
    if (!user) return;
    const completedItems = items.filter(i => i.completed);
    if (completedItems.length === 0) return;

    try {
      const batch = writeBatch(db);
      completedItems.forEach(item => {
        batch.delete(doc(db, 'grocery', item.id));
      });
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'grocery/batch');
    }
  };

  const handleAddMissing = async () => {
    if (!user) return;
    setIsSyncing(true);
    
    try {
      // 1. Fetch all meals
      const mealsSnapshot = await getDocs(query(collection(db, 'meals'), where('uid', '==', user.uid)));
      const meals = mealsSnapshot.docs.map(doc => doc.data() as Meal);

      // 2. Extract raw ingredients
      const rawIngredients: any[] = [];
      meals.forEach(meal => {
        meal.ingredients?.forEach(ing => {
          rawIngredients.push(ing);
        });
      });

      if (rawIngredients.length === 0) {
        setIsSyncing(false);
        return;
      }

      // 3. Optional AI consolidation fallback to raw, followed by canonical normalization & aggregation
      let consolidatedList: any[] = [];
      try {
        consolidatedList = await consolidateGroceries(rawIngredients);
      } catch (err) {
        consolidatedList = rawIngredients;
      }

      const consolidated = aggregateIngredients(
        consolidatedList && consolidatedList.length > 0 ? consolidatedList : rawIngredients
      );

      // 4. Fetch all inventory
      const inventorySnapshot = await getDocs(query(collection(db, 'inventory'), where('uid', '==', user.uid)));
      const inventory = inventorySnapshot.docs.map(doc => doc.data() as InventoryItem);

      // 5. Determine missing ingredients using normalized matching
      const missing: any[] = [];
      consolidated.forEach((req) => {
        const normReqName = normalizeIngredientName(req.name);

        const invItem = inventory.find(i => {
          const normInvName = normalizeIngredientName(i.name);
          return normInvName === normReqName || 
                 normInvName.toLowerCase().includes(normReqName.toLowerCase()) || 
                 normReqName.toLowerCase().includes(normInvName.toLowerCase());
        });
        
        const invAmount = invItem ? Number(invItem.quantity) : 0;
        
        let amountNeeded = req.amount;
        if (invItem && invAmount > 0) {
          const invUnit = (invItem.unit || '').toLowerCase();
          const reqUnit = (req.unit || '').toLowerCase();
          
          if (invUnit === reqUnit || !reqUnit || !invUnit) {
            amountNeeded = Math.max(0, req.amount - invAmount);
          } else {
            amountNeeded = 0;
          }
        }

        if (amountNeeded > 0) {
          missing.push({ 
            name: normReqName, 
            amount: amountNeeded, 
            unit: req.unit, 
            category: req.category || 'General' 
          });
        }
      });

      // 6. Aggregate missing items under canonical names
      const finalMissing = aggregateIngredients(missing);

      // 7. Add or update missing items in the grocery list
      if (finalMissing.length > 0) {
        const batch = writeBatch(db);
        finalMissing.forEach(item => {
          const existingInGrocery = items.find(i => 
            normalizeIngredientName(i.name) === item.name && !i.completed
          );

          if (existingInGrocery) {
            const newAmount = (existingInGrocery.amount || 0) + item.amount;
            batch.update(doc(db, 'grocery', existingInGrocery.id), {
              amount: newAmount,
              unit: item.unit || existingInGrocery.unit || 'unit'
            });
          } else {
            const docRef = doc(collection(db, 'grocery'));
            batch.set(docRef, {
              name: item.name,
              amount: item.amount,
              unit: item.unit || 'unit',
              category: item.category || 'General',
              completed: false,
              uid: user.uid
            });
          }
        });
        await batch.commit();
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'grocery/sync');
    } finally {
      setIsSyncing(false);
    }
  };

  const categories = Array.from(new Set(items.map(i => i.category || 'General')));

  return (
    <div className="max-w-2xl mx-auto space-y-10">
      {/* Header Actions */}
      <section>
        <div className="flex flex-col gap-2 mb-8">
          <span className="text-primary-fixed text-xs font-headline font-bold tracking-[0.3em] uppercase">NEON PANTRY Module</span>
          <div className="flex justify-between items-end">
            <h2 className="text-5xl font-extrabold font-headline tracking-tighter text-on-surface">Grocery.</h2>
            <div className="flex gap-2">
              {items.length > 0 && (
                <button 
                  onClick={handleSelectAll}
                  className="px-3 py-2 bg-surface-container-high text-on-surface rounded-lg border border-outline-variant/30 hover:bg-surface-container-highest transition-colors text-[10px] font-headline font-bold uppercase tracking-widest flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">done_all</span>
                  {items.every(i => i.completed) ? 'Deselect All' : 'Select All'}
                </button>
              )}
              {items.some(i => i.completed) && (
                <button 
                  onClick={handleClearCompleted}
                  className="px-3 py-2 bg-error/10 text-error rounded-lg border border-error/20 hover:bg-error/20 transition-colors text-[10px] font-headline font-bold uppercase tracking-widest flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">delete</span>
                  Clear Done
                </button>
              )}
            </div>
          </div>
        </div>
        <button 
          onClick={handleAddMissing}
          disabled={isSyncing}
          className="w-full liquid-gradient text-on-primary py-5 rounded-xl font-bold font-headline uppercase tracking-widest flex items-center justify-center gap-3 shadow-[0_12px_30px_rgba(161,255,194,0.15)] active:scale-[0.98] transition-all cursor-pointer disabled:opacity-70"
        >
          <span className="material-symbols-outlined">{isSyncing ? 'sync' : 'calendar_month'}</span>
          {isSyncing ? 'Syncing...' : 'Sync from Meal Plan'}
        </button>
      </section>

      {/* Grocery Categories */}
      <div className="space-y-12">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 bg-surface-container rounded-xl animate-pulse"></div>
            ))}
          </div>
        ) : categories.length > 0 ? (
          categories.map(category => (
            <section key={category}>
              <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4 mb-6">
                <h3 className="font-headline text-xl font-bold tracking-tight text-on-surface flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                    {category === 'Produce' ? 'eco' : category === 'Dairy' ? 'egg_alt' : 'package_2'}
                  </span>
                  {category}
                </h3>
                <span className="text-[10px] font-headline bg-surface-container-highest px-3 py-1 rounded-full text-on-surface-variant font-bold tracking-widest uppercase">
                  {items.filter(i => i.category === category).length} Items
                </span>
              </div>
              <div className="space-y-4">
                <AnimatePresence>
                  {items.filter(i => i.category === category).map((item) => (
                    <motion.div
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      key={item.id}
                      className={clsx(
                        "group relative overflow-hidden rounded-xl transition-all duration-300",
                        item.completed ? "bg-surface-container-low opacity-50" : "bg-surface-container hover:bg-surface-container-high"
                      )}
                    >
                      <div className="flex items-center p-5 gap-4">
                        <input 
                          type="checkbox" 
                          checked={item.completed}
                          onChange={() => toggleComplete(item)}
                          className="w-6 h-6 rounded-lg bg-surface-container-highest border-none text-primary-fixed focus:ring-0 cursor-pointer"
                        />
                        <div className="flex-grow">
                          {inlineEditId === item.id ? (
                            <div className="flex items-center gap-2 my-1">
                              <input 
                                type="text"
                                value={inlineEditName}
                                onChange={(e) => setInlineEditName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveInlineEdit(item);
                                  if (e.key === 'Escape') setInlineEditId(null);
                                }}
                                autoFocus
                                className="bg-surface-container-highest border border-primary/50 text-on-surface font-bold text-base px-2 py-1 rounded-lg focus:ring-2 focus:ring-primary outline-none"
                              />
                              <button 
                                onClick={() => handleSaveInlineEdit(item)}
                                className="p-1.5 bg-primary text-on-primary rounded-lg hover:bg-primary/80 transition-colors cursor-pointer"
                                title="Save"
                              >
                                <span className="material-symbols-outlined text-sm">check</span>
                              </button>
                              <button 
                                onClick={() => setInlineEditId(null)}
                                className="p-1.5 bg-surface-container-highest text-on-surface-variant rounded-lg hover:bg-surface-container-high transition-colors cursor-pointer"
                                title="Cancel"
                              >
                                <span className="material-symbols-outlined text-sm">close</span>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <p className={clsx("font-bold text-on-surface text-lg", item.completed && "line-through")}>{item.name}</p>
                              <button 
                                onClick={() => handleStartInlineEdit(item)}
                                className="opacity-60 hover:opacity-100 text-on-surface-variant hover:text-primary transition-all cursor-pointer p-1 rounded-md"
                                title="Edit Item Name"
                              >
                                <span className="material-symbols-outlined text-sm">edit</span>
                              </button>
                            </div>
                          )}
                          <p className="text-xs text-on-surface-variant uppercase tracking-widest mt-0.5">
                            {item.amount ? `Qty: ${item.amount} ${item.unit || ''}` : 'Qty: 1 Unit'}
                          </p>
                        </div>
                        <a 
                          href={`https://www.walmart.ca/en/search?q=${encodeURIComponent(item.name)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-2 bg-[#0071ce]/10 text-[#0071ce] rounded-lg hover:bg-[#0071ce]/20 transition-colors text-[10px] font-headline font-bold uppercase tracking-widest flex items-center gap-1"
                          title="Search on Walmart.ca"
                        >
                          <span className="material-symbols-outlined text-sm">shopping_bag</span>
                          <span className="hidden sm:inline">Walmart</span>
                        </a>
                        <button 
                          onClick={() => deleteItem(item.id)}
                          className="material-symbols-outlined text-on-surface-variant/30 group-hover:text-error transition-colors cursor-pointer ml-2"
                        >
                          delete
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          ))
        ) : (
          <div className="text-center py-20 bg-surface-container rounded-xl border border-dashed border-outline-variant/30">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-4">shopping_cart</span>
            <p className="text-on-surface-variant">Your shopping list is empty.</p>
          </div>
        )}
      </div>

      {/* Quick Add Bar */}
      <div className="fixed bottom-20 left-0 w-full px-4 pb-4 z-50">
        <form onSubmit={handleAddItem} className="max-w-2xl mx-auto glass-panel border border-outline-variant/20 rounded-2xl p-2 flex items-center shadow-2xl">
          <input 
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            className="flex-grow bg-transparent border-none text-on-surface placeholder:text-on-surface-variant/50 focus:ring-0 px-4 font-headline uppercase tracking-tighter text-sm" 
            placeholder="Quick add item..." 
            type="text"
          />
          <button type="submit" className="bg-surface-container-highest text-primary-fixed p-3 rounded-xl hover:bg-primary-fixed hover:text-on-primary transition-all active:scale-95">
            <span className="material-symbols-outlined">add</span>
          </button>
          <Link to="/scan" className="bg-surface-container-highest text-secondary p-3 rounded-xl ml-2 hover:bg-secondary hover:text-on-secondary transition-all active:scale-95">
            <span className="material-symbols-outlined">barcode_scanner</span>
          </Link>
        </form>
      </div>
    </div>
  );
}
