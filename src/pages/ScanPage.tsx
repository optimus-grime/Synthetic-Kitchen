import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { identifyIngredients } from '../services/geminiService';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, getDocs, query, where, writeBatch, doc } from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { useNavigate } from 'react-router-dom';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function ScanPage() {
  const [user] = useAuthState(auth);
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [detections, setDetections] = useState<any[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    async function startCamera() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' } 
        });
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      } catch (err) {
        console.error("Camera access denied:", err);
        setError("Camera access denied. Please check permissions or upload a photo.");
      }
    }
    startCamera();
    return () => stream?.getTracks().forEach(track => track.stop());
  }, []);

  const processImage = async (base64Image: string) => {
    setScanning(true);
    setError(null);
    setDetections([]);
    try {
      const results = await identifyIngredients(base64Image);
      setDetections(results.map((item: any) => ({
        ...item,
        id: Math.random().toString(36).substr(2, 9),
        expiry: item.expiryDays || 7,
        selected: true
      })));
    } catch (err) {
      console.error("Identification failed:", err);
      setError("Failed to identify items. Please try again.");
    } finally {
      setScanning(false);
    }
  };

  const handleScan = async () => {
    if (!videoRef.current || !canvasRef.current || !user) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    
    // Ensure video is playing and has dimensions
    if (video.videoWidth === 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    
    const base64Image = canvas.toDataURL('image/jpeg').split(',')[1];
    await processImage(base64Image);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64Image = (reader.result as string).split(',')[1];
      await processImage(base64Image);
    };
    reader.readAsDataURL(file);
  };

  const addToInventory = async () => {
    const selectedItems = detections.filter(d => d.selected);
    if (!user || selectedItems.length === 0) return;
    
    setIsAdding(true);
    try {
      // Fetch existing inventory to check for duplicates
      const inventoryRef = collection(db, 'inventory');
      const q = query(inventoryRef, where('uid', '==', user.uid));
      const snapshot = await getDocs(q);
      const existingItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));

      const batch = writeBatch(db);
      
      // Group selected items by name (case-insensitive) to handle duplicates within the scan itself
      const groupedSelected = selectedItems.reduce((acc, item) => {
        const nameKey = item.name.toLowerCase().trim();
        if (!acc[nameKey]) {
          acc[nameKey] = { ...item };
        } else {
          acc[nameKey].quantity = (acc[nameKey].quantity || 1) + (item.quantity || 1);
        }
        return acc;
      }, {} as Record<string, any>);

      for (const item of Object.values(groupedSelected) as any[]) {
        const existingItem = existingItems.find(ei => ei.name.toLowerCase().trim() === item.name.toLowerCase().trim());
        
        if (existingItem) {
          // Update existing item quantity
          const docRef = doc(db, 'inventory', existingItem.id);
          batch.update(docRef, {
            quantity: existingItem.quantity + (item.quantity || 1),
            lifetimePurchased: (existingItem.lifetimePurchased || 0) + (item.quantity || 1),
            lifetimeSpent: (existingItem.lifetimeSpent || 0) + ((item.quantity || 1) * (item.price || 0))
          });
        } else {
          // Add new item
          const docRef = doc(collection(db, 'inventory'));
          batch.set(docRef, {
            name: item.name,
            quantity: item.quantity || 1,
            unit: item.unit || 'ct',
            uid: user.uid,
            category: item.category || 'General',
            price: item.price || 0,
            expiryDate: new Date(Date.now() + (item.expiryDays || 7) * 24 * 60 * 60 * 1000).toISOString(),
            lowStockThreshold: 1,
            lifetimePurchased: item.quantity || 1,
            lifetimeSpent: (item.quantity || 1) * (item.price || 0)
          });
        }
      }

      await batch.commit();
      setDetections([]);
      navigate('/inventory');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'inventory');
    } finally {
      setIsAdding(false);
    }
  };

  const toggleSelection = (id: string) => {
    setDetections(prev => prev.map(d => 
      d.id === id ? { ...d, selected: !d.selected } : d
    ));
  };

  return (
    <div className="fixed inset-0 z-[60] bg-background flex flex-col font-body">
      {/* Top App Bar */}
      <header className="fixed top-0 w-full z-50 flex justify-between items-center px-6 py-4 bg-background border-b border-outline-variant/20 shadow-[0px_0px_20px_rgba(161,255,194,0.1)]">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="text-primary active:scale-95 duration-150 cursor-pointer">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="text-2xl font-black text-primary tracking-widest font-headline tracking-tighter uppercase">NEON PANTRY</h1>
        </div>
        <div className="w-10 h-10 rounded-full bg-surface-container-high border border-outline-variant flex items-center justify-center overflow-hidden">
          <img alt="User Profile" className="w-full h-full object-cover" src={user?.photoURL || ""} referrerPolicy="no-referrer" />
        </div>
      </header>

      {/* Main Camera Viewport */}
      <main className="relative flex-1 w-full pt-16 pb-32 overflow-hidden bg-surface-container-lowest">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          className="absolute inset-0 w-full h-full object-cover opacity-60 grayscale-[20%]"
        />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background/80"></div>

        {/* Scanning HUD Overlay */}
        <div className="absolute inset-0 z-10 pointer-events-none flex flex-col items-center justify-center">
          {/* Viewfinder Corners */}
          <div className="relative w-72 h-72 md:w-96 md:h-96">
            <div className="viewfinder-corner top-0 left-0 border-t-2 border-l-2 rounded-tl-xl opacity-80"></div>
            <div className="viewfinder-corner top-0 right-0 border-t-2 border-r-2 rounded-tr-xl opacity-80"></div>
            <div className="viewfinder-corner bottom-0 left-0 border-b-2 border-l-2 rounded-bl-xl opacity-80"></div>
            <div className="viewfinder-corner bottom-0 right-0 border-b-2 border-r-2 rounded-br-xl opacity-80"></div>
            
            {/* Scanning Laser Sweep */}
            <div className={cn("absolute inset-x-0 top-1/2 scan-line blur-md transition-all duration-1000", scanning ? "animate-pulse opacity-100" : "opacity-40")}></div>

            {/* Recognition Reticle */}
            <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-start gap-2">
              <div className={cn("flex items-center gap-2 bg-primary/10 backdrop-blur-md border border-primary/30 px-3 py-1 rounded-full shadow-[0px_0px_12px_rgba(161,255,194,0.2)]", scanning ? "opacity-100" : "opacity-0")}>
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
                <span className="font-headline text-[10px] tracking-widest text-primary uppercase">Identifying...</span>
              </div>
            </div>

            {/* Floating Data Points (AR Style) */}
            <AnimatePresence>
              {detections.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="absolute top-1/2 left-2/3 flex flex-col gap-3 pointer-events-auto max-h-[200px] overflow-y-auto hide-scrollbar"
                >
                  {detections.slice(0, 3).map((d, i) => (
                    <div key={d.id} className="flex flex-col border-l border-primary/50 pl-3 py-1 bg-background/40 backdrop-blur-sm rounded-r-lg">
                      <span className="text-[10px] font-headline text-primary/60 uppercase">Item {i + 1}</span>
                      <span className="text-sm font-headline font-bold text-on-surface">{d.name}</span>
                    </div>
                  ))}
                  {detections.length > 3 && (
                    <div className="text-[10px] font-headline text-primary/60 uppercase pl-3">
                      + {detections.length - 3} more items
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Status Indicator */}
          <div className="mt-12 flex flex-col items-center">
            <div className="text-on-surface-variant font-headline text-sm tracking-[0.2em] uppercase opacity-70">
              {scanning ? "Processing Image..." : "Point camera at item"}
            </div>
            <div className="mt-4 flex gap-2">
              <span className={cn("w-1 h-1 rounded-full bg-primary", !scanning && "opacity-20")}></span>
              <span className={cn("w-1 h-1 rounded-full bg-primary", !scanning && "opacity-40")}></span>
              <span className={cn("w-1 h-1 rounded-full bg-primary", !scanning && "opacity-100")}></span>
            </div>
          </div>
        </div>

        {/* Control Buttons */}
        <div className="absolute right-6 top-1/2 -translate-y-1/2 flex flex-col gap-6 z-20">
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept="image/*" 
            onChange={handleFileUpload}
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="w-12 h-12 rounded-full bg-surface-container-high/80 backdrop-blur-xl border border-outline-variant flex items-center justify-center text-on-surface hover:text-primary transition-colors"
          >
            <span className="material-symbols-outlined">upload_file</span>
          </button>
          <button onClick={handleScan} disabled={scanning} className="w-16 h-16 rounded-full bg-primary text-on-primary flex items-center justify-center shadow-[0_0_30px_rgba(161,255,194,0.4)] active:scale-90 transition-all">
            <span className="material-symbols-outlined text-3xl">{scanning ? 'sync' : 'photo_camera'}</span>
          </button>
          <button className="w-12 h-12 rounded-full bg-surface-container-high/80 backdrop-blur-xl border border-outline-variant flex items-center justify-center text-on-surface hover:text-primary transition-colors">
            <span className="material-symbols-outlined">history</span>
          </button>
        </div>

        {/* Error Message Overlay */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-36 left-1/2 -translate-x-1/2 bg-error/90 backdrop-blur-md text-on-error px-6 py-3 rounded-xl border border-error/50 z-30 flex items-center gap-3"
            >
              <span className="material-symbols-outlined">error</span>
              <span className="text-xs font-headline font-bold uppercase tracking-widest">{error}</span>
              <button onClick={() => setError(null)} className="ml-2">
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Sheet / Identification Result */}
      <AnimatePresence>
        {detections.length > 0 && (
          <motion.section 
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="fixed bottom-0 left-0 w-full z-50"
          >
            <div className="bg-surface-bright/95 backdrop-blur-2xl rounded-t-[2rem] border-t border-outline-variant/30 p-8 shadow-[0px_-8px_40px_rgba(0,0,0,0.5)] max-h-[80vh] overflow-y-auto">
              {/* Drag Handle */}
              <div className="w-12 h-1.5 bg-outline-variant/50 rounded-full mx-auto mb-8"></div>
              
              <div className="flex flex-col gap-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-headline font-black text-on-surface uppercase">Items Detected ({detections.length})</h2>
                  <button 
                    onClick={() => setDetections([])}
                    className="text-on-surface-variant hover:text-primary transition-colors"
                  >
                    <span className="material-symbols-outlined">close</span>
                  </button>
                </div>

                <div className="space-y-3">
                  {detections.map((item) => (
                    <div 
                      key={item.id}
                      onClick={() => toggleSelection(item.id)}
                      className={cn(
                        "flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer",
                        item.selected 
                          ? "bg-primary/10 border-primary/40 shadow-[0_0_15px_rgba(161,255,194,0.1)]" 
                          : "bg-surface-container-highest/40 border-outline-variant/20 opacity-60"
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                          item.selected ? "bg-primary border-primary" : "border-outline-variant"
                        )}>
                          {item.selected && <span className="material-symbols-outlined text-[16px] text-on-primary font-bold">check</span>}
                        </div>
                        <div>
                          <p className="font-headline font-bold text-on-surface uppercase tracking-tight">{item.name}</p>
                          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest">{item.category} • {item.confidence}% confidence</p>
                        </div>
                      </div>
                      <div className="text-right flex flex-col items-end">
                        <span className="text-[10px] font-headline text-primary uppercase font-bold">
                          {item.quantity || 1} {item.unit || 'ct'} {item.price ? `• $${item.price.toFixed(2)}` : ''}
                        </span>
                        <span className="text-[10px] font-headline text-tertiary uppercase">~{item.expiryDays || 7}d shelf life</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={() => setDetections([])}
                    className="flex-1 px-6 py-4 rounded-xl border border-outline text-on-surface font-headline font-bold uppercase tracking-widest text-xs hover:bg-surface-container-high transition-colors active:scale-95 duration-150"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={addToInventory}
                    disabled={isAdding || detections.filter(d => d.selected).length === 0}
                    className="flex-[2] px-8 py-4 rounded-xl bg-gradient-to-br from-primary to-primary-container text-on-primary font-headline font-black uppercase tracking-widest text-xs shadow-[0px_0px_20px_rgba(161,255,194,0.3)] hover:brightness-110 transition-all active:scale-95 duration-150 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAdding ? (
                      <>
                        <span className="material-symbols-outlined animate-spin text-[20px]">sync</span>
                        Adding...
                      </>
                    ) : (
                      <>
                        <span className="material-symbols-outlined text-[20px]">add_circle</span>
                        Add {detections.filter(d => d.selected).length} Items
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}
