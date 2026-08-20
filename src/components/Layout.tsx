import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { auth } from '../firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import SettingsModal from './SettingsModal';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [user] = useAuthState(auth);
  const location = useLocation();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const navItems = [
    { path: '/', label: 'Meals', icon: 'calendar_view_week' },
    { path: '/recipes', label: 'Recipes', icon: 'menu_book' },
    { path: '/inventory', label: 'Pantry', icon: 'kitchen' },
    { path: '/grocery', label: 'Grocery', icon: 'shopping_cart' },
  ];

  return (
    <div className="min-h-screen bg-background text-on-background selection:bg-primary selection:text-on-primary">
      {/* TopAppBar */}
      <header className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-xl flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-primary-container overflow-hidden bg-surface-container">
            {user?.photoURL ? (
              <img alt="User Profile" className="w-full h-full object-cover" src={user.photoURL} referrerPolicy="no-referrer" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-primary">
                <span className="material-symbols-outlined">person</span>
              </div>
            )}
          </div>
          <h1 className="font-headline tracking-tighter uppercase text-2xl font-black text-primary tracking-widest">NEON PANTRY</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex gap-6 text-[10px] font-headline uppercase font-bold">
            {navItems.map((item) => (
              <NavLink 
                key={item.path} 
                to={item.path}
                className={({ isActive }) => cn(
                  "transition-colors",
                  isActive ? "text-primary" : "text-on-surface-variant hover:text-secondary"
                )}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="w-10 h-10 rounded-full flex items-center justify-center text-on-surface hover:bg-surface-container-high transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[20px]">settings</span>
          </button>
        </div>
      </header>

      <main className="pt-24 pb-32 px-4 md:px-8 max-w-7xl mx-auto">
        {children}
      </main>

      {/* BottomNavBar */}
      <nav className="fixed bottom-0 w-full z-50 border-t border-outline-variant/20 bg-background/80 backdrop-blur-xl shadow-[0_-8px_24px_rgba(161,255,194,0.1)] flex justify-around items-center h-20 px-4">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => cn(
              "flex flex-col items-center justify-center transition-all duration-200",
              isActive ? "text-primary scale-110" : "text-on-surface-variant/50 hover:text-secondary"
            )}
          >
            <span 
              className="material-symbols-outlined"
              style={{ fontVariationSettings: `'FILL' ${location.pathname === item.path ? 1 : 0}` }}
            >
              {item.icon}
            </span>
            <span className="font-body text-[10px] uppercase font-bold tracking-widest mt-1">{item.label}</span>
          </NavLink>
        ))}
      </nav>
      
      {user && (
        <SettingsModal 
          isOpen={isSettingsOpen} 
          onClose={() => setIsSettingsOpen(false)} 
          uid={user.uid} 
        />
      )}
    </div>
  );
}
