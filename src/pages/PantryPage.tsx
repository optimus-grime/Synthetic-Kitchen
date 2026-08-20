import React, { useState, useEffect } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { InventoryItem } from '../types';
import { useAuthState } from 'react-firebase-hooks/auth';
import { motion, AnimatePresence } from 'motion/react';
import { Link, useLocation } from 'react-router-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { normalizeIngredientName } from '../utils/ingredientNormalizer';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function PantryPage() {
  const [user] = useAuthState(auth);
  const location = useLocation();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'pantry' | 'shopping'>(
    location.pathname === '/grocery' ? 'shopping' : 'pantry'
  );
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [quickAddName, setQuickAddName] = useState('');
  
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditName, setInlineEditName] = useState<string>('');

  const [newItem, setNewItem] = useState({
    name: '',
    quantity: 1,
    unit: 'unit',
    category: 'Vegetables',
    price: 0,
    expiryDate: '',
    lowStockThreshold: 100
  });

  useEffect(() => {
    if (location.pathname === '/grocery') {
      setActiveTab('shopping');
    } else if (location.pathname === '/inventory') {
      setActiveTab('pantry');
    }
  }, [location.pathname]);

  const [hasSeeded, setHasSeeded] = useState(false);

  const handleSeedSampleItems = async () => {
    if (!user) return;
    const sampleItems = [
      // Meat & Poultry
      { name: 'Steak', category: 'Meat & Poultry', quantity: 2, unit: 'unit', needToBuy: true },
      { name: 'Shrimp', category: 'Meat & Poultry', quantity: 1, unit: 'lb', needToBuy: true },
      { name: 'Chicken', category: 'Meat & Poultry', quantity: 3, unit: 'lb', needToBuy: true },
      { name: 'Pork', category: 'Meat & Poultry', quantity: 2, unit: 'unit', needToBuy: true },
      
      // Produce
      { name: 'Salad', category: 'Produce', quantity: 1, unit: 'bag', needToBuy: true },
      { name: 'Strawberry', category: 'Produce', quantity: 2, unit: 'pint', needToBuy: true },
      { name: 'Grapes', category: 'Produce', quantity: 1, unit: 'bunch', needToBuy: true },
      { name: 'Bananas', category: 'Produce', quantity: 6, unit: 'unit', needToBuy: true },
      { name: 'Lemon', category: 'Produce', quantity: 3, unit: 'unit', needToBuy: true },
      { name: 'Onion', category: 'Produce', quantity: 2, unit: 'bulb', needToBuy: true },

      // Pantry
      { name: 'Mac + Cheese', category: 'Pantry', quantity: 2, unit: 'box', needToBuy: true },
      { name: 'Yellow Rice', category: 'Pantry', quantity: 1, unit: 'bag', needToBuy: true },
      { name: 'Peanut Butter', category: 'Pantry', quantity: 1, unit: 'jar', needToBuy: true },
      { name: 'Beef Broth', category: 'Pantry', quantity: 2, unit: 'carton', needToBuy: true },
      { name: 'Chocolate Chips', category: 'Pantry', quantity: 1, unit: 'bag', needToBuy: true },
      { name: 'Brown Sugar', category: 'Pantry', quantity: 1, unit: 'bag', needToBuy: true },
      { name: 'Baking Soda', category: 'Pantry', quantity: 1, unit: 'box', needToBuy: true },
      { name: 'Dr. Pepper', category: 'Pantry', quantity: 12, unit: 'can', needToBuy: true },
      { name: 'Nuts', category: 'Pantry', quantity: 1, unit: 'bag', needToBuy: true },
      { name: 'Pretzels', category: 'Pantry', quantity: 1, unit: 'bag', needToBuy: true },

      // Frozen
      { name: 'Chicken Strips', category: 'Frozen', quantity: 1, unit: 'bag', needToBuy: true },
      { name: 'Frozen Pizza', category: 'Frozen', quantity: 2, unit: 'unit', needToBuy: true },

      // Dairy
      { name: 'Butter', category: 'Dairy', quantity: 2, unit: 'pack', needToBuy: true },
      { name: 'Milk', category: 'Dairy', quantity: 1, unit: 'gallon', needToBuy: false },
      { name: 'Eggs', category: 'Dairy', quantity: 12, unit: 'unit', needToBuy: false },

      // Household
      { name: 'Water Bottles x2', category: 'Household', quantity: 2, unit: 'pack', needToBuy: true },
      { name: 'Olive Oil', category: 'Pantry', quantity: 1, unit: 'bottle', needToBuy: false },
      { name: 'Garlic', category: 'Produce', quantity: 3, unit: 'bulb', needToBuy: false }
    ];

    try {
      const batch = writeBatch(db);
      sampleItems.forEach(item => {
        const docRef = doc(collection(db, 'inventory'));
        batch.set(docRef, {
          uid: user.uid,
          name: item.name,
          category: item.category,
          quantity: item.quantity,
          unit: item.unit,
          price: 0,
          needToBuy: item.needToBuy,
          lowStockThreshold: 0
        });
      });
      await batch.commit();
      setHasSeeded(true);
    } catch (error) {
      console.error("Error seeding sample items", error);
    }
  };

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'inventory'), where('uid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
      setItems(itemsData);
      setLoading(false);

      if (itemsData.length === 0 && !hasSeeded) {
        setHasSeeded(true);
        handleSeedSampleItems();
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'inventory');
    });
    return () => unsubscribe();
  }, [user]);

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newItem.name.trim()) return;
    try {
      await addDoc(collection(db, 'inventory'), {
        ...newItem,
        uid: user.uid,
        quantity: activeTab === 'shopping' ? 0 : Number(newItem.quantity),
        price: Number(newItem.price),
        needToBuy: activeTab === 'shopping'
      });
      setIsAddModalOpen(false);
      setNewItem({ name: '', quantity: 1, unit: 'unit', category: 'Vegetables', price: 0, expiryDate: '', lowStockThreshold: 0 });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'inventory');
    }
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !quickAddName.trim()) return;
    const normName = normalizeIngredientName(quickAddName.trim());
    try {
      await addDoc(collection(db, 'inventory'), {
        name: normName,
        quantity: 1,
        unit: 'unit',
        category: 'Vegetables',
        price: 0,
        uid: user.uid,
        needToBuy: activeTab === 'shopping'
      });
      setQuickAddName('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'inventory');
    }
  };

  const toggleNeedToBuy = async (item: InventoryItem) => {
    try {
      await updateDoc(doc(db, 'inventory', item.id), { needToBuy: !item.needToBuy });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `inventory/${item.id}`);
    }
  };

  const handleGotIt = async (item: InventoryItem) => {
    try {
      await updateDoc(doc(db, 'inventory', item.id), { needToBuy: false, quantity: (item.quantity || 0) + 1 });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `inventory/${item.id}`);
    }
  };

  const handleDeleteSelected = async () => {
    if (!user || selectedItemIds.length === 0) return;
    try {
      const batch = writeBatch(db);
      selectedItemIds.forEach(id => batch.delete(doc(db, 'inventory', id)));
      await batch.commit();
      setSelectedItemIds([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'inventory/batch');
    }
  };

  const toggleSelectItem = (id: string) => {
    setSelectedItemIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSaveInlineEdit = async (item: InventoryItem) => {
    if (!inlineEditName.trim() || !user) {
      setInlineEditId(null);
      return;
    }
    try {
      await updateDoc(doc(db, 'inventory', item.id), { name: normalizeIngredientName(inlineEditName.trim()) });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `inventory/${item.id}`);
    } finally {
      setInlineEditId(null);
    }
  };

  // Filter items by tab
  const tabFilteredItems = items.filter(i => activeTab === 'pantry' ? !i.needToBuy : i.needToBuy);

  // Notion database standard categories
  const standardCategories = [
    'Produce',
    'Meat & Poultry',
    'Dairy',
    'Bakery',
    'Pantry',
    'Frozen',
    'Household'
  ];

  const normalizeCategory = (cat?: string, name?: string): string => {
    const combined = `${cat || ''} ${name || ''}`.toLowerCase();
    if (combined.includes('veg') || combined.includes('produce') || combined.includes('lemon') || combined.includes('onion') || combined.includes('garlic') || combined.includes('salad') || combined.includes('strawb') || combined.includes('grape') || combined.includes('banana') || combined.includes('banna') || combined.includes('apple') || combined.includes('tomato') || combined.includes('potato') || combined.includes('fruit') || combined.includes('berry') || combined.includes('lettuce') || combined.includes('carrot') || combined.includes('celery') || combined.includes('pepper') || combined.includes('avocado')) return 'Produce';
    if (combined.includes('meat') || combined.includes('poultry') || combined.includes('steak') || combined.includes('shrimp') || combined.includes('chicken') || combined.includes('chicekn') || combined.includes('pork') || combined.includes('beef') || combined.includes('fish') || combined.includes('salmon') || combined.includes('bacon') || combined.includes('turkey')) return 'Meat & Poultry';
    if (combined.includes('dair') || combined.includes('milk') || combined.includes('cheese') || combined.includes('butter') || combined.includes('yogurt') || combined.includes('egg') || combined.includes('cream')) return 'Dairy';
    if (combined.includes('bak') || combined.includes('bread') || combined.includes('bagel') || combined.includes('muffin') || combined.includes('croissant') || combined.includes('tortilla')) return 'Bakery';
    if (combined.includes('frozen') || combined.includes('pizza') || combined.includes('strip')) return 'Frozen';
    if (combined.includes('water') || combined.includes('paper') || combined.includes('clean') || combined.includes('household') || combined.includes('trash') || combined.includes('napkin')) return 'Household';
    
    const match = standardCategories.find(sc => sc.toLowerCase() === (cat || '').toLowerCase().trim());
    if (match) return match;

    return 'Pantry';
  };

  const handleSelectAll = () => {
    if (selectedItemIds.length === tabFilteredItems.length) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(tabFilteredItems.map(i => i.id));
    }
  };

  const handleDeleteAll = async () => {
    if (!user || tabFilteredItems.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete all ${tabFilteredItems.length} items?`)) return;
    try {
      const batch = writeBatch(db);
      tabFilteredItems.forEach(item => {
        batch.delete(doc(db, 'inventory', item.id));
      });
      await batch.commit();
      setSelectedItemIds([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'inventory/deleteAll');
    }
  };

  const categories: Record<string, InventoryItem[]> = {};
  standardCategories.forEach(cat => { categories[cat] = []; });
  
  tabFilteredItems.forEach(item => {
    const normCat = normalizeCategory(item.category, item.name);
    if (!categories[normCat]) categories[normCat] = [];
    categories[normCat].push(item);
  });

  return (
    <div className="max-w-7xl mx-auto space-y-8 px-4 sm:px-6 lg:px-8 py-8 bg-[#fdfbf7] min-h-screen text-[#332922]">
      {/* Notion Page Header */}
      <div className="space-y-4 border-b border-[#e8dfd3] pb-6">
        <div className="flex items-center gap-3">
          <div className="text-4xl bg-[#f4eee6] p-3 rounded-2xl shadow-sm border border-[#e8dfd3]">
            🛍️
          </div>
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight text-[#2c221e] font-serif">
              {activeTab === 'pantry' ? 'Pantry Inventory' : 'Shopping list'}
            </h1>
            <p className="text-xs text-[#786c62] mt-1 uppercase tracking-widest font-mono">
              Notion Workspace • {tabFilteredItems.length} Active Items
            </p>
          </div>
        </div>

        {/* Tab Switcher & Actions */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <div className="bg-[#f4eee6] p-1.5 rounded-xl flex border border-[#e8dfd3] shadow-inner">
            <button
              onClick={() => { setActiveTab('pantry'); setSelectedItemIds([]); }}
              className={cn(
                "px-5 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-all",
                activeTab === 'pantry' ? "bg-white text-[#2c221e] shadow-sm" : "text-[#786c62] hover:text-[#2c221e]"
              )}
            >
              Pantry Inventory ({items.filter(i => !i.needToBuy).length})
            </button>
            <button
              onClick={() => { setActiveTab('shopping'); setSelectedItemIds([]); }}
              className={cn(
                "px-5 py-2 rounded-lg font-bold text-xs uppercase tracking-widest transition-all",
                activeTab === 'shopping' ? "bg-[#d4a373] text-white shadow-sm" : "text-[#786c62] hover:text-[#2c221e]"
              )}
            >
              Grocery List ({items.filter(i => i.needToBuy).length})
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleSelectAll}
              className="px-4 py-2.5 bg-[#f4eee6] text-[#4a4036] rounded-xl font-bold uppercase tracking-widest text-xs border border-[#e8dfd3] hover:bg-[#ebdccc] transition-colors flex items-center gap-1.5 shadow-2xs"
            >
              <span className="material-symbols-outlined text-sm">select_all</span>
              {selectedItemIds.length === tabFilteredItems.length && tabFilteredItems.length > 0 ? 'Deselect All' : 'Select All'}
            </button>
            {selectedItemIds.length > 0 && (
              <button 
                onClick={handleDeleteSelected}
                className="px-4 py-2.5 bg-red-50 text-red-700 rounded-xl text-xs font-bold uppercase tracking-widest border border-red-200 hover:bg-red-100 transition-colors flex items-center gap-1.5 shadow-2xs"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
                Delete Selected ({selectedItemIds.length})
              </button>
            )}
            {tabFilteredItems.length > 0 && (
              <button 
                onClick={handleDeleteAll}
                className="px-4 py-2.5 bg-red-50 text-red-700 rounded-xl text-xs font-bold uppercase tracking-widest border border-red-200 hover:bg-red-100 transition-colors flex items-center gap-1.5 shadow-2xs"
              >
                <span className="material-symbols-outlined text-sm">delete_sweep</span>
                Delete All
              </button>
            )}
            <button
              onClick={handleSeedSampleItems}
              className="px-4 py-2.5 bg-[#f4eee6] text-[#4a4036] rounded-xl font-bold uppercase tracking-widest text-xs border border-[#e8dfd3] shadow-2xs hover:bg-[#ebdccc] transition-colors flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">playlist_add</span>
              Load Sample Items
            </button>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-5 py-2.5 bg-[#2c221e] text-[#fdfbf7] rounded-xl font-bold uppercase tracking-widest text-xs shadow hover:bg-[#43342d] transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              + New Item
            </button>
            <Link
              to="/scan"
              className="px-4 py-2.5 bg-[#d4a373] text-white rounded-xl font-bold uppercase tracking-widest text-xs shadow hover:bg-[#bc8a5f] transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">photo_camera</span>
              Scan
            </Link>
          </div>
        </div>
      </div>

      {/* Quick Add Bar */}
      <form onSubmit={handleQuickAdd} className="flex gap-3 max-w-2xl">
        <input
          type="text"
          value={quickAddName}
          onChange={(e) => setQuickAddName(e.target.value)}
          placeholder="Type new item (e.g., Organic Bananas)..."
          className="flex-1 bg-white border border-[#e8dfd3] rounded-xl py-3 px-4 text-sm text-[#2c221e] focus:ring-2 focus:ring-[#d4a373] outline-none shadow-sm font-medium"
        />
        <button
          type="submit"
          disabled={!quickAddName.trim()}
          className="px-6 py-3 bg-[#d4a373] text-white rounded-xl font-bold uppercase tracking-widest text-xs disabled:opacity-50 transition-all shadow hover:bg-[#bc8a5f]"
        >
          Add Item
        </button>
      </form>

      {/* Notion-Style Multi-Column Category Grid */}
      <div className="space-y-8 pb-24">
        <div className="flex items-center gap-2">
          <span className="text-xl">🥗</span>
          <h2 className="text-xl font-bold text-[#2c221e] font-serif uppercase tracking-wider">Food Categories</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {loading ? (
            <div className="col-span-full h-64 bg-[#f4eee6] rounded-2xl animate-pulse"></div>
          ) : (
            standardCategories.map((category, idx) => {
              const catItems = categories[category] || [];
              return (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  key={category}
                  className="bg-white rounded-xl border border-[#e8dfd3] shadow-sm overflow-hidden flex flex-col"
                >
                  {/* Category Header Badge */}
                  <div className="bg-[#f4eee6]/80 px-4 py-3 border-b border-[#e8dfd3] flex justify-between items-center">
                    <span className="px-3 py-1 bg-white/90 rounded-md text-xs font-bold text-[#4a4036] border border-[#e8dfd3] uppercase tracking-wider shadow-2xs">
                      {category}
                    </span>
                    <span className="text-xs font-mono text-[#786c62] font-bold">
                      {catItems.length}
                    </span>
                  </div>

                  {/* Items List - Upgraded touch targets */}
                  <div className="p-2.5 space-y-2 flex-1 min-h-[140px]">
                    {catItems.length > 0 ? (
                      catItems.map((item) => {
                        const isSelected = selectedItemIds.includes(item.id);
                        return (
                          <div 
                            key={item.id}
                            className={cn(
                              "group flex items-center justify-between py-3 px-3 rounded-xl transition-all hover:bg-[#fcfaf7] min-h-[52px] border border-transparent hover:border-[#e8dfd3]",
                              isSelected && "bg-[#f4eee6] border-[#d4a373]/50"
                            )}
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
                              <button 
                                onClick={() => toggleSelectItem(item.id)}
                                className={cn(
                                  "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all flex-shrink-0",
                                  isSelected ? "bg-[#d4a373] border-[#d4a373] text-white" : "border-[#d8ccbe] bg-white hover:border-[#bc8a5f]"
                                )}
                              >
                                {isSelected && <span className="material-symbols-outlined text-xs font-bold">check</span>}
                              </button>

                              <div className="flex-1 min-w-0">
                                {inlineEditId === item.id ? (
                                  <input 
                                    type="text"
                                    value={inlineEditName}
                                    onChange={(e) => setInlineEditName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleSaveInlineEdit(item);
                                      if (e.key === 'Escape') setInlineEditId(null);
                                    }}
                                    autoFocus
                                    className="bg-white border border-[#d4a373] text-[#2c221e] text-sm px-2 py-1 rounded-lg outline-none w-full font-semibold uppercase"
                                  />
                                ) : (
                                  <span 
                                    onClick={(e) => { e.stopPropagation(); setInlineEditId(item.id); setInlineEditName(item.name); }}
                                    className="text-sm font-semibold text-[#2c221e] truncate cursor-pointer hover:text-[#d4a373] transition-colors block py-0.5"
                                  >
                                    {item.name}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="px-2 py-1 bg-[#f8f5f0] text-[#786c62] rounded-md text-xs font-mono font-bold">
                                {item.quantity} {item.unit || ''}
                              </span>

                              <a
                                href={`https://www.walmart.com/search?q=${encodeURIComponent(item.name)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1.5 bg-[#0071dc] text-white rounded-md text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 hover:bg-[#004f9e] transition-colors shadow-2xs"
                                title="Search & buy on Walmart"
                              >
                                <span className="material-symbols-outlined text-xs">shopping_cart</span>
                                Walmart
                              </a>

                              {activeTab === 'pantry' ? (
                                <button 
                                  onClick={() => toggleNeedToBuy(item)}
                                  className="text-xs font-bold text-[#786c62] hover:text-[#d4a373] px-2.5 py-1.5 rounded-lg bg-[#f4eee6] border border-[#e8dfd3]"
                                  title="Move to Grocery List"
                                >
                                  Need
                                </button>
                              ) : (
                                <button 
                                  onClick={() => handleGotIt(item)}
                                  className="text-xs font-bold text-white bg-[#d4a373] hover:bg-[#bc8a5f] px-3 py-1.5 rounded-lg shadow-2xs"
                                  title="Mark Got It"
                                >
                                  Got
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-xs text-[#b0a496] italic px-3 py-8 text-center bg-[#fcfaf7] rounded-xl border border-dashed border-[#e8dfd3]">
                        No items in {category}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      {/* Manual Add Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddModalOpen(false)}
              className="absolute inset-0 bg-[#2c221e]/40 backdrop-blur-xs"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-md bg-white border border-[#e8dfd3] rounded-2xl p-6 shadow-2xl"
            >
              <h2 className="text-xl font-bold mb-4 font-serif text-[#2c221e]">Add New Item</h2>
              <form onSubmit={handleManualAdd} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#786c62]">Item Name</label>
                  <input 
                    required
                    value={newItem.name}
                    onChange={e => setNewItem({...newItem, name: e.target.value})}
                    className="w-full bg-[#fdfbf7] border border-[#e8dfd3] rounded-xl py-2.5 px-3 text-sm text-[#2c221e] focus:ring-2 focus:ring-[#d4a373] outline-none"
                    placeholder="e.g. Avocado"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#786c62]">Quantity</label>
                    <input 
                      type="number"
                      value={newItem.quantity}
                      onChange={e => setNewItem({...newItem, quantity: Number(e.target.value)})}
                      className="w-full bg-[#fdfbf7] border border-[#e8dfd3] rounded-xl py-2.5 px-3 text-sm text-[#2c221e] focus:ring-2 focus:ring-[#d4a373] outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-[#786c62]">Unit</label>
                    <input 
                      value={newItem.unit}
                      onChange={e => setNewItem({...newItem, unit: e.target.value})}
                      className="w-full bg-[#fdfbf7] border border-[#e8dfd3] rounded-xl py-2.5 px-3 text-sm text-[#2c221e] focus:ring-2 focus:ring-[#d4a373] outline-none"
                      placeholder="e.g. pcs, g"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#786c62]">Category</label>
                  <select
                    value={newItem.category}
                    onChange={e => setNewItem({...newItem, category: e.target.value})}
                    className="w-full bg-[#fdfbf7] border border-[#e8dfd3] rounded-xl py-2.5 px-3 text-sm text-[#2c221e] focus:ring-2 focus:ring-[#d4a373] outline-none"
                  >
                    {standardCategories.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div className="pt-2 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl border border-[#e8dfd3] text-[#786c62] font-bold uppercase tracking-widest text-xs hover:bg-[#fdfbf7]"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-[#2c221e] text-white font-bold uppercase tracking-widest text-xs shadow hover:bg-[#43342d]"
                  >
                    Add
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
