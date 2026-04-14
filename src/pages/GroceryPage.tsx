import React, { useState, useEffect } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch, getDocs } from 'firebase/firestore';
import { GroceryItem, Meal, InventoryItem } from '../types';
import { useAuthState } from 'react-firebase-hooks/auth';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Link, useNavigate } from 'react-router-dom';

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

    try {
      await addDoc(collection(db, 'grocery'), {
        name: newItemName.trim(),
        completed: false,
        uid: user.uid,
        category: 'General'
      });
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

      // 2. Fetch all inventory
      const inventorySnapshot = await getDocs(query(collection(db, 'inventory'), where('uid', '==', user.uid)));
      const inventory = inventorySnapshot.docs.map(doc => doc.data() as InventoryItem);

      // 3. Calculate required ingredients
      const required = new Map<string, {amount: number, unit: string}>();
      const ignoreList = ['water', 'salt', 'pepper', 'black pepper', 'tap water'];

      meals.forEach(meal => {
        meal.ingredients?.forEach(ing => {
          const key = ing.name.toLowerCase().trim();
          if (ignoreList.includes(key)) return;
          
          if (!required.has(key)) required.set(key, { amount: 0, unit: ing.unit });
          required.get(key)!.amount += Number(ing.amount);
        });
      });

      // 4. Determine missing ingredients
      const missing: any[] = [];
      required.forEach((req, name) => {
        const invItem = inventory.find(i => i.name.toLowerCase().trim() === name);
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

      // 5. Add missing to grocery list if not already there
      if (missing.length > 0) {
        const batch = writeBatch(db);
        missing.forEach(item => {
          // Check if already in grocery list
          const alreadyInGrocery = items.some(i => i.name.toLowerCase().trim() === item.name.toLowerCase().trim() && !i.completed);
          if (!alreadyInGrocery) {
            const docRef = doc(collection(db, 'grocery'));
            batch.set(docRef, {
              ...item,
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
                          <p className={clsx("font-bold text-on-surface text-lg", item.completed && "line-through")}>{item.name}</p>
                          <p className="text-xs text-on-surface-variant uppercase tracking-widest">
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
