import React, { useState, useEffect } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { InventoryItem } from '../types';
import { useAuthState } from 'react-firebase-hooks/auth';
import { motion, AnimatePresence } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function InventoryPage() {
  const [user] = useAuthState(auth);
  const navigate = useNavigate();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  
  // Manual Add Form State
  const [newItem, setNewItem] = useState({
    name: '',
    quantity: 1,
    unit: 'g',
    category: 'General',
    price: 0,
    expiryDate: '',
    lowStockThreshold: 100
  });

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'inventory'),
      where('uid', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
      setItems(itemsData);
      setLoading(false);
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
        quantity: Number(newItem.quantity),
        price: Number(newItem.price),
        lowStockThreshold: Number(newItem.lowStockThreshold),
        lifetimePurchased: Number(newItem.quantity),
        lifetimeSpent: Number(newItem.quantity) * Number(newItem.price)
      });
      setIsAddModalOpen(false);
      setNewItem({
        name: '',
        quantity: 1,
        unit: 'g',
        category: 'General',
        price: 0,
        expiryDate: '',
        lowStockThreshold: 100
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'inventory');
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !editingItem) return;

    try {
      const { id, ...data } = editingItem;
      const originalItem = items.find(i => i.id === id);
      const quantityDiff = Number(data.quantity) - (originalItem?.quantity || 0);
      
      const updates: any = {
        ...data,
        quantity: Number(data.quantity),
        price: Number(data.price),
        lowStockThreshold: Number(data.lowStockThreshold)
      };

      if (quantityDiff > 0) {
        updates.lifetimePurchased = (originalItem?.lifetimePurchased || 0) + quantityDiff;
        updates.lifetimeSpent = (originalItem?.lifetimeSpent || 0) + (quantityDiff * Number(data.price));
      }

      await updateDoc(doc(db, 'inventory', id), updates);
      setIsEditModalOpen(false);
      setEditingItem(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `inventory/${editingItem.id}`);
    }
  };

  const handleDeleteSelected = async () => {
    if (!user || selectedItemIds.length === 0) return;

    try {
      const batch = writeBatch(db);
      selectedItemIds.forEach(id => {
        batch.delete(doc(db, 'inventory', id));
      });
      await batch.commit();
      setSelectedItemIds([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'inventory/batch');
    }
  };

  const toggleSelectItem = (id: string) => {
    setSelectedItemIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    if (selectedItemIds.length === items.length && items.length > 0) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(items.map(item => item.id));
    }
  };

  const startEditing = (item: InventoryItem) => {
    setEditingItem(item);
    setIsEditModalOpen(true);
  };

  const totalUnits = items.reduce((acc, item) => acc + item.quantity, 0);
  const totalValue = items.reduce((acc, item) => acc + (item.price || 0) * item.quantity, 0);

  // Group items by category
  const categories = items.reduce((acc, item) => {
    const cat = item.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(item);
    return acc;
  }, {} as Record<string, InventoryItem[]>);

  return (
    <div className="space-y-10">
      {/* Quick Actions Grid */}
      <section className="grid grid-cols-2 gap-4">
        <Link to="/scan" className="group relative flex flex-col items-center justify-center p-6 bg-surface-container rounded-xl border border-outline-variant/10 hover:border-primary/40 transition-all duration-300">
          <div className="mb-3 text-primary-fixed group-hover:scale-110 transition-transform duration-300">
            <span className="material-symbols-outlined text-4xl">barcode_scanner</span>
          </div>
          <span className="font-headline font-bold text-sm tracking-widest uppercase text-on-surface">Scan Barcode</span>
          <div className="absolute inset-0 bg-primary/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl"></div>
        </Link>
        <Link 
          to="/scan"
          className="group relative flex flex-col items-center justify-center p-6 bg-surface-container rounded-xl border border-outline-variant/10 hover:border-secondary/40 transition-all duration-300"
        >
          <div className="mb-3 text-secondary group-hover:scale-110 transition-transform duration-300">
            <span className="material-symbols-outlined text-4xl">photo_camera</span>
          </div>
          <span className="font-headline font-bold text-sm tracking-widest uppercase text-on-surface">Identify Image</span>
          <div className="absolute inset-0 bg-secondary/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-xl"></div>
        </Link>
      </section>

      {/* Inventory Header */}
      <div className="flex justify-between items-end">
        <div>
          <p className="font-headline text-on-surface-variant text-xs uppercase tracking-[0.3em] mb-1">Stock Status (CAD)</p>
          <h2 className="font-headline text-4xl font-bold tracking-tighter">INVENTORY</h2>
        </div>
        <div className="flex items-center gap-4">
          {items.length > 0 && (
            <button 
              onClick={handleSelectAll}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors",
                selectedItemIds.length === items.length && items.length > 0
                  ? "bg-primary text-on-primary border-primary"
                  : "bg-surface-container-high text-on-surface border-outline-variant/30 hover:bg-surface-container-highest"
              )}
            >
              <span className="material-symbols-outlined text-sm">
                {selectedItemIds.length === items.length && items.length > 0 ? 'deselect' : 'select_all'}
              </span>
              <span className="text-[10px] font-headline font-bold uppercase tracking-widest">
                {selectedItemIds.length === items.length && items.length > 0 ? 'Deselect All' : 'Select All'}
              </span>
            </button>
          )}
          {selectedItemIds.length > 0 && (
            <button 
              onClick={handleDeleteSelected}
              className="flex items-center gap-2 px-4 py-2 bg-error/10 text-error rounded-lg border border-error/20 hover:bg-error/20 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">delete</span>
              <span className="text-[10px] font-headline font-bold uppercase tracking-widest">Delete ({selectedItemIds.length})</span>
            </button>
          )}
          <div className="text-right ml-2">
            <p className="font-headline text-primary text-2xl font-bold leading-none">${totalValue.toFixed(2)}</p>
            <p className="text-[10px] uppercase tracking-widest text-on-surface-variant">Est. Total Value (CAD)</p>
          </div>
        </div>
      </div>

      {/* Inventory Categories - Card Gallery Style */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-20">
        {loading ? (
          <div className="col-span-full h-64 bg-surface-container rounded-xl animate-pulse"></div>
        ) : Object.keys(categories).length > 0 ? (
          Object.entries(categories).map(([category, categoryItems]: [string, InventoryItem[]], idx) => (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: idx * 0.1 }}
              key={category}
              className="bg-surface-container rounded-2xl border border-outline-variant/10 overflow-hidden shadow-lg"
            >
              <div className="bg-surface-container-high px-6 py-4 border-b border-outline-variant/20 flex justify-between items-center">
                <h3 className="font-headline font-black text-xl tracking-tight uppercase text-primary">{category}</h3>
                <span className="px-3 py-1 bg-primary/10 text-primary text-[10px] font-bold rounded-full uppercase tracking-widest">
                  {categoryItems.length} Items
                </span>
              </div>
              <div className="p-4 space-y-3">
                {categoryItems.map((item) => {
                  const isLow = item.lowStockThreshold && item.quantity <= item.lowStockThreshold;
                  const isSelected = selectedItemIds.includes(item.id);
                  return (
                    <div 
                      key={item.id}
                      className={cn(
                        "flex items-center gap-4 p-4 rounded-xl transition-all border",
                        isSelected ? "bg-primary/10 border-primary/40 shadow-inner" : "bg-surface-container-highest/40 hover:bg-surface-container-highest/60 border-transparent",
                        isLow && !isSelected && "bg-tertiary/5 border-tertiary/20"
                      )}
                    >
                      <button 
                        onClick={() => toggleSelectItem(item.id)}
                        className={cn(
                          "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all",
                          isSelected ? "bg-primary border-primary" : "border-outline-variant"
                        )}
                      >
                        {isSelected && <span className="material-symbols-outlined text-[16px] text-on-primary font-bold">check</span>}
                      </button>

                      <div className="flex-1 cursor-pointer" onClick={() => startEditing(item)}>
                        <div className="flex items-center gap-2">
                          <p className="font-headline font-bold text-on-surface uppercase tracking-tight">{item.name}</p>
                          {isLow && (
                            <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse"></span>
                          )}
                        </div>
                        <div className="flex gap-4 mt-1">
                          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest">
                            Qty: <span className="text-on-surface font-bold">{item.quantity} {item.unit}</span>
                          </p>
                          {item.price && (
                            <p className="text-[10px] text-on-surface-variant uppercase tracking-widest">
                              Price: <span className="text-primary font-bold">${item.price.toFixed(2)}</span>
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-headline font-black text-on-surface">
                          ${((item.price || 0) * item.quantity).toFixed(2)}
                        </p>
                        <p className="text-[8px] text-on-surface-variant uppercase tracking-widest">Subtotal</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          ))
        ) : (
          <div className="col-span-full text-center py-20 bg-surface-container rounded-xl border border-dashed border-outline-variant/30">
            <span className="material-symbols-outlined text-4xl text-on-surface-variant/30 mb-4">inventory_2</span>
            <p className="text-on-surface-variant">Inventory is empty. Scan items to add them.</p>
          </div>
        )}
      </div>

      {/* Manual Add Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddModalOpen(false)}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-surface-container border border-outline-variant/30 rounded-2xl p-8 shadow-2xl"
            >
              <h2 className="font-headline text-2xl font-bold mb-6 tracking-tight">MANUAL ENTRY</h2>
              <form onSubmit={handleManualAdd} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Item Name</label>
                  <input 
                    required
                    value={newItem.name}
                    onChange={e => setNewItem({...newItem, name: e.target.value})}
                    className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline uppercase tracking-tighter text-sm focus:ring-2 focus:ring-primary"
                    placeholder="E.G. WHOLE MILK"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Quantity</label>
                    <input 
                      type="number"
                      value={newItem.quantity}
                      onChange={e => setNewItem({...newItem, quantity: Number(e.target.value)})}
                      className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Unit (g, kg, ml, L, ct)</label>
                    <input 
                      value={newItem.unit}
                      onChange={e => setNewItem({...newItem, unit: e.target.value})}
                      className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                      placeholder="E.G. g"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Category</label>
                    <input 
                      value={newItem.category}
                      onChange={e => setNewItem({...newItem, category: e.target.value})}
                      className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                      placeholder="E.G. DAIRY"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Price ($)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={newItem.price}
                      onChange={e => setNewItem({...newItem, price: Number(e.target.value)})}
                      className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Expiry Date</label>
                  <input 
                    type="date"
                    value={newItem.expiryDate}
                    onChange={e => setNewItem({...newItem, expiryDate: e.target.value})}
                    className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="flex-1 py-4 rounded-xl border border-outline-variant text-on-surface font-headline font-bold uppercase tracking-widest text-xs"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-4 rounded-xl bg-primary text-on-primary font-headline font-black uppercase tracking-widest text-xs shadow-lg"
                  >
                    Add Item
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {isEditModalOpen && editingItem && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditModalOpen(false)}
              className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-surface-container border border-outline-variant/30 rounded-2xl p-8 shadow-2xl"
            >
              <h2 className="font-headline text-2xl font-bold mb-6 tracking-tight">EDIT ITEM</h2>
              <form onSubmit={handleEdit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Item Name</label>
                  <input 
                    required
                    value={editingItem.name}
                    onChange={e => setEditingItem({...editingItem, name: e.target.value})}
                    className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline uppercase tracking-tighter text-sm focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Quantity</label>
                    <input 
                      type="number"
                      value={editingItem.quantity}
                      onChange={e => setEditingItem({...editingItem, quantity: Number(e.target.value)})}
                      className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Unit</label>
                    <input 
                      value={editingItem.unit}
                      onChange={e => setEditingItem({...editingItem, unit: e.target.value})}
                      className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Category</label>
                    <input 
                      value={editingItem.category}
                      onChange={e => setEditingItem({...editingItem, category: e.target.value})}
                      className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest text-on-surface-variant">Price (CAD $)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={editingItem.price}
                      onChange={e => setEditingItem({...editingItem, price: Number(e.target.value)})}
                      className="w-full bg-surface-container-highest border-none rounded-xl py-3 px-4 font-headline text-sm focus:ring-2 focus:ring-primary"
                    />
                  </div>
                </div>
                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    className="flex-1 py-4 rounded-xl border border-outline-variant text-on-surface font-headline font-bold uppercase tracking-widest text-xs"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-4 rounded-xl bg-primary text-on-primary font-headline font-black uppercase tracking-widest text-xs shadow-lg"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <button 
        onClick={() => setIsAddModalOpen(true)}
        className="fixed bottom-24 right-6 w-16 h-16 rounded-full bg-gradient-to-br from-primary to-primary-container text-on-primary shadow-[0_0_30px_rgba(161,255,194,0.3)] flex items-center justify-center active:scale-90 transition-transform z-[60]"
      >
        <span className="material-symbols-outlined text-3xl" style={{ fontVariationSettings: "'wght' 600" }}>add</span>
      </button>
    </div>
  );
}
