import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, query, where, onSnapshot } from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { useNavigate } from 'react-router-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { InventoryItem } from '../types';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function WalmartFlyerPage() {
  const [user] = useAuthState(auth);
  const navigate = useNavigate();
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncComplete, setSyncComplete] = useState(false);
  const [cartItems, setCartItems] = useState<string[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [matches, setMatches] = useState<any[]>([]);

  // Fetch real inventory to find low stock items
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'inventory'),
      where('uid', '==', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem));
      setInventoryItems(items);
      
      // Filter for low stock items and "match" them with mock deals
      const lowStock = items.filter(item => (item.lowStockThreshold || 0) >= item.quantity);
      
      const generatedMatches = lowStock.map(item => ({
        id: item.id,
        name: item.name,
        status: 'Low Stock in Pantry',
        price: (item.price || 5.00) * 0.85, // Simulate 15% discount
        oldPrice: item.price || 5.00,
        savings: (item.price || 5.00) * 0.15,
        unit: item.unit,
        walmartUrl: `https://www.walmart.ca/search?q=${encodeURIComponent(item.name)}`
      }));

      // If no low stock items, show some default "Essential" deals
      if (generatedMatches.length === 0) {
        setMatches([
          {
            id: 'default-1',
            name: 'Whole Milk (4L)',
            status: 'Pantry Essential',
            price: 5.27,
            oldPrice: 6.48,
            savings: 1.21,
            unit: 'L',
            walmartUrl: 'https://www.walmart.ca/search?q=milk+4l'
          },
          {
            id: 'default-2',
            name: 'Large White Eggs (12ct)',
            status: 'Pantry Essential',
            price: 3.12,
            oldPrice: 4.28,
            savings: 1.16,
            unit: 'ct',
            walmartUrl: 'https://www.walmart.ca/search?q=eggs+12ct'
          }
        ]);
      } else {
        setMatches(generatedMatches);
      }
    });

    return () => unsubscribe();
  }, [user]);

  const handleSync = () => {
    setIsSyncing(true);
    // This simulates the API call to Walmart.ca's shopping list service
    setTimeout(() => {
      setIsSyncing(false);
      setSyncComplete(true);
      setTimeout(() => setSyncComplete(false), 3000);
    }, 2000);
  };

  const toggleCart = (id: string) => {
    setCartItems(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const addToGrocery = async (item: any) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'grocery'), {
        name: item.name,
        category: 'General',
        amount: 1,
        unit: 'Unit',
        completed: false,
        uid: user.uid
      });
      navigate('/grocery');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'grocery');
    }
  };

  return (
    <div className="space-y-12 pb-24">
      {/* Header Section */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
          <span className="text-primary font-headline text-xs tracking-widest uppercase font-bold">Live Integration Active</span>
        </div>
        <h2 className="text-4xl md:text-6xl font-headline font-black text-on-surface leading-none mb-4 uppercase">
          Walmart.ca Flyer <br/>
          <span className="text-primary-container">Weekly Savings (CAD)</span>
        </h2>
        <p className="text-on-surface-variant max-w-xl text-lg font-light">
          We've synchronized your local Walmart.ca flyer with your pantry inventory. Discover deals on everyday essentials you actually use in Canada.
        </p>
      </motion.div>

      {/* Main Sync Button */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mb-12"
      >
        <button 
          onClick={handleSync}
          disabled={isSyncing}
          className={cn(
            "liquid-neon group flex items-center gap-4 px-8 py-5 rounded-xl shadow-[0_0_30px_rgba(161,255,194,0.2)] hover:scale-[1.02] active:scale-95 transition-all relative overflow-hidden",
            isSyncing && "opacity-80 cursor-wait"
          )}
        >
          <AnimatePresence mode="wait">
            {isSyncing ? (
              <motion.div 
                key="syncing"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-3"
              >
                <span className="material-symbols-outlined animate-spin text-on-primary">sync</span>
                <span className="text-on-primary font-headline font-black text-xl uppercase tracking-wider">Synchronizing...</span>
              </motion.div>
            ) : syncComplete ? (
              <motion.div 
                key="complete"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-3"
              >
                <span className="material-symbols-outlined text-on-primary">check_circle</span>
                <span className="text-on-primary font-headline font-black text-xl uppercase tracking-wider">Sync Successful</span>
              </motion.div>
            ) : (
              <motion.div 
                key="idle"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-3"
              >
                <span className="text-on-primary font-headline font-black text-xl uppercase tracking-wider">Sync to Walmart.ca App</span>
                <span className="material-symbols-outlined text-on-primary text-3xl font-bold group-hover:translate-x-1 transition-transform">sync_alt</span>
              </motion.div>
            )}
          </AnimatePresence>
        </button>
      </motion.div>

      {/* Matching Inventory Section */}
      <section className="mb-16">
        <div className="flex items-baseline justify-between mb-8">
          <h3 className="text-2xl font-headline font-bold uppercase tracking-tight text-on-surface">Matching Your Inventory</h3>
          <span className="text-on-surface-variant text-sm font-medium uppercase tracking-widest">{matches.length} Matches Found</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {matches.map((item, i) => (
            <motion.div 
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="surface-container-low glass-card rounded-xl overflow-hidden group border border-outline-variant/10"
            >
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="space-y-1">
                    <div className="bg-error/10 text-error px-2 py-0.5 rounded text-[10px] font-headline font-black uppercase w-fit mb-2">
                      Save ${item.savings.toFixed(2)}
                    </div>
                    <h4 className="text-xl font-headline font-bold text-on-surface uppercase tracking-tight">{item.name}</h4>
                    <p className="text-on-surface-variant text-[10px] uppercase tracking-widest font-bold">{item.status}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-headline font-black text-primary">${item.price.toFixed(2)}</p>
                    <p className="text-on-surface-variant text-[10px] line-through font-bold">${item.oldPrice.toFixed(2)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-outline-variant/20">
                  <div className="flex flex-col">
                    <span className="text-on-surface-variant text-[10px] font-bold uppercase tracking-widest">Sync to Walmart.ca Cart</span>
                    <a 
                      href={item.walmartUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-primary text-[10px] font-bold uppercase tracking-widest hover:underline flex items-center gap-1 mt-1"
                    >
                      View on Walmart.ca
                      <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                    </a>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={cartItems.includes(item.id)}
                      onChange={() => toggleCart(item.id)}
                    />
                    <div className="w-11 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-on-surface-variant after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary peer-checked:after:bg-on-primary"></div>
                  </label>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>
    </div>
  );
}
