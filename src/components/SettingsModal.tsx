import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  uid: string;
}

export default function SettingsModal({ isOpen, onClose, uid }: SettingsModalProps) {
  const [preferences, setPreferences] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !uid) return;
    
    const loadPreferences = async () => {
      try {
        const docRef = doc(db, 'userPreferences', uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setPreferences(docSnap.data().dietaryPreferences || '');
        }
      } catch (error) {
        console.error("Failed to load preferences:", error);
      }
    };
    
    loadPreferences();
  }, [isOpen, uid]);

  const handleSave = async () => {
    if (!uid) return;
    setIsSaving(true);
    try {
      await setDoc(doc(db, 'userPreferences', uid), {
        dietaryPreferences: preferences
      }, { merge: true });
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'userPreferences');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }} 
            className="absolute inset-0 bg-background/80 backdrop-blur-sm" 
            onClick={onClose} 
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            exit={{ opacity: 0, scale: 0.95 }} 
            className="relative bg-surface-container p-6 rounded-2xl max-w-lg w-full border border-outline-variant/30 shadow-2xl flex flex-col max-h-[90vh]"
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-headline text-2xl font-black uppercase tracking-widest text-primary">Dietary Preferences</h3>
              <button onClick={onClose} className="text-on-surface-variant hover:text-primary transition-colors">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            
            <div className="space-y-4 overflow-y-auto hide-scrollbar flex-1">
              <p className="text-on-surface-variant text-sm leading-relaxed">
                Add any dietary restrictions, allergies, or ingredients you dislike. These preferences will be used when generating new meal plans.
              </p>
              
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Preferences (e.g. No dairy, dislikes mushrooms)</label>
                <textarea 
                  value={preferences}
                  onChange={e => setPreferences(e.target.value)}
                  className="w-full bg-surface-container-highest border-none rounded-xl py-4 px-4 font-body text-sm focus:ring-2 focus:ring-primary min-h-[150px] resize-none"
                  placeholder="e.g. Vegetarian, no peanuts, dislike spicy foods..."
                />
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-outline-variant/20 flex gap-3">
              <button 
                onClick={onClose} 
                className="flex-1 py-3 rounded-xl border border-outline-variant font-headline font-bold text-xs uppercase tracking-widest hover:bg-surface-container-high transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSave} 
                disabled={isSaving}
                className="flex-1 py-3 rounded-xl bg-primary text-on-primary font-headline font-bold text-xs uppercase tracking-widest hover:brightness-110 transition-all shadow-lg disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save Preferences'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
