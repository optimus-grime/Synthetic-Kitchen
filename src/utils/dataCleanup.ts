import { db } from '../firebase';
import { collection, query, where, getDocs, doc, writeBatch } from 'firebase/firestore';
import { normalizeIngredientName } from './ingredientNormalizer';

/**
 * Scans user's inventory and grocery items, normalizes brand/prep names,
 * and merges any duplicate items with identical canonical names.
 */
export async function runBulkCleanup(userId: string) {
  if (!userId) return;

  try {
    // 1. CLEANUP INVENTORY
    const invRef = collection(db, 'inventory');
    const invSnap = await getDocs(query(invRef, where('uid', '==', userId)));
    
    const invMap = new Map<string, any[]>();
    invSnap.docs.forEach(d => {
      const data = { id: d.id, ...(d.data() as any) };
      const normName = normalizeIngredientName(data.name || '');
      if (!invMap.has(normName)) {
        invMap.set(normName, []);
      }
      invMap.get(normName)!.push(data);
    });

    const invBatch = writeBatch(db);
    let invChanges = false;

    invMap.forEach((group, normName) => {
      if (group.length === 1) {
        const item = group[0];
        if (item.name !== normName) {
          invBatch.update(doc(db, 'inventory', item.id), { name: normName });
          invChanges = true;
        }
      } else if (group.length > 1) {
        const primary = group[0];
        let totalQuantity = Number(primary.quantity) || 0;
        let totalPurchased = Number(primary.lifetimePurchased) || 0;
        let totalSpent = Number(primary.lifetimeSpent) || 0;
        let needToBuy = Boolean(primary.needToBuy);

        for (let i = 1; i < group.length; i++) {
          const item = group[i];
          totalQuantity += Number(item.quantity) || 0;
          totalPurchased += Number(item.lifetimePurchased) || 0;
          totalSpent += Number(item.lifetimeSpent) || 0;
          if (item.needToBuy) needToBuy = true;

          invBatch.delete(doc(db, 'inventory', item.id));
        }

        invBatch.update(doc(db, 'inventory', primary.id), {
          name: normName,
          quantity: totalQuantity,
          lifetimePurchased: totalPurchased,
          lifetimeSpent: totalSpent,
          needToBuy: needToBuy
        });
        invChanges = true;
      }
    });

    if (invChanges) {
      await invBatch.commit();
    }

    // 2. CLEANUP GROCERY
    const grocRef = collection(db, 'grocery');
    const grocSnap = await getDocs(query(grocRef, where('uid', '==', userId)));

    const grocMap = new Map<string, any[]>();
    grocSnap.docs.forEach(d => {
      const data = { id: d.id, ...(d.data() as any) };
      const normName = normalizeIngredientName(data.name || '');
      const key = `${normName}_${data.completed ? 'completed' : 'active'}`;
      if (!grocMap.has(key)) {
        grocMap.set(key, []);
      }
      grocMap.get(key)!.push(data);
    });

    const grocBatch = writeBatch(db);
    let grocChanges = false;

    grocMap.forEach((group, key) => {
      const normName = key.split('_')[0];
      if (group.length === 1) {
        const item = group[0];
        if (item.name !== normName) {
          grocBatch.update(doc(db, 'grocery', item.id), { name: normName });
          grocChanges = true;
        }
      } else if (group.length > 1) {
        const primary = group[0];
        let totalAmount = Number(primary.amount) || 1;

        for (let i = 1; i < group.length; i++) {
          const item = group[i];
          totalAmount += Number(item.amount) || 1;
          grocBatch.delete(doc(db, 'grocery', item.id));
        }

        grocBatch.update(doc(db, 'grocery', primary.id), {
          name: normName,
          amount: totalAmount
        });
        grocChanges = true;
      }
    });

    if (grocChanges) {
      await grocBatch.commit();
    }
  } catch (err) {
    console.error('Error in bulk cleanup migration:', err);
  }
}
