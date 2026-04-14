/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { auth } from './firebase';
import { useAuthState } from 'react-firebase-hooks/auth';
import Layout from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';

// Pages
import LoginPage from './pages/LoginPage';
import MealsPage from './pages/MealsPage';
import RecipesPage from './pages/RecipesPage';
import InventoryPage from './pages/InventoryPage';
import GroceryPage from './pages/GroceryPage';
import ScanPage from './pages/ScanPage';

export default function App() {
  const [user, loading] = useAuthState(auth);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <Router>
      <ErrorBoundary>
        <Layout>
          <Routes>
            <Route path="/" element={<MealsPage />} />
            <Route path="/recipes" element={<RecipesPage />} />
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/grocery" element={<Navigate to="/inventory" replace />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </ErrorBoundary>
    </Router>
  );
}

