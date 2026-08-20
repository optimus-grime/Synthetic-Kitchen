export function normalizeIngredientName(rawName: string): string {
  if (!rawName) return '';

  let str = rawName.trim();

  // 1. Strip brand names
  const brandNames = [
    'géant vert', 'geant vert', 'green giant', 'great value', 'dairyland',
    'aylmer', 'kraft', 'swanson', 'heinz', "campbell's", 'campbells',
    "hellmann's", 'hellmanns', 'barilla', 'philadelphia', 'mccormick',
    'quaker', "french's", 'frenchs', "stouffer's", 'stouffers', 'pillsbury',
    'del monte', "hunt's", 'hunts', 'clover leaf', 'robin hood',
    "fleischmann's", 'fleischmanns', "mott's", 'motts', 'rogers',
    'carnation', 'nestle', 'nestlé', 'saporito', 'primico', 'unico',
    'catelli', 'no name', 'selection'
  ];

  for (const brand of brandNames) {
    const pattern = new RegExp(`\\b${brand.replace("'", "['’]?")}\\b`, 'gi');
    str = str.replace(pattern, '');
  }

  // 2. Strip modifiers, fat percentages, and preparation actions
  const descriptors = [
    // Prep actions
    'diced', 'minced', 'sliced', 'drained', 'flaked', 'chopped',
    'shredded', 'grated', 'beaten', 'melted', 'cubed', 'crushed',
    'pureed', 'puréed', 'peeled', 'trimmed', 'divided', 'sifted',
    'thawed', 'softened', 'coarsely', 'finely', 'thinly', 'thickly',
    'cooked', 'raw',
    // Milk & Dairy descriptors / fat content
    '2%', '1%', '3.25%', 'skimmmed', 'skimmed', 'partly skimmed', 
    'homogenized', 'whole', 'fat free', 'low fat', 'extra lean',
    // Tuna & Meat descriptors
    'in water', 'in oil', 'light', 'chunk', 'solid', 'white', 'flaked'
  ];

  for (const desc of descriptors) {
    const pattern = new RegExp(`\\b${desc}\\b`, 'gi');
    str = str.replace(pattern, '');
  }

  // 3. Clean extra spaces, punctuation, and numbers/weights like "200 g"
  str = str.replace(/\b\d+\s*g\b/gi, ''); // remove weights like 200g
  str = str.replace(/[,\(\)]/g, ' ').replace(/\s+/g, ' ').trim();

  if (!str) return rawName.trim();

  // 4. Format Title Case
  let formatted = str
    .split(' ')
    .map(word => {
      if (!word) return '';
      if (/^\d+%?$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ')
    .trim();

  // 5. Hard Canonical Grouping (Root Mapping)
  const lowerStr = formatted.toLowerCase();

  if (/milk/i.test(lowerStr)) return 'Milk';
  if (/tuna/i.test(lowerStr)) return 'Tuna';
  if (/onion/i.test(lowerStr)) return 'Onion';
  if (/pasta|macaroni|noodles/i.test(lowerStr) && !/kraft dinner/i.test(lowerStr)) {
    // Keep KD distinct if you want, or map generic pasta variants
    if (/macaroni|noodles|pasta/i.test(lowerStr) && !/kraft dinner/i.test(lowerStr)) {
      return 'Pasta & Noodles';
    }
  }
  if (/creamed corn/i.test(lowerStr)) return 'Cream Corn';

  return formatted;
}

export function aggregateIngredients(ingredients: any[]): any[] {
  const map = new Map<string, { name: string; amount: number; unit: string; category?: string }>();
  for (const ing of ingredients) {
    const norm = normalizeIngredientName(ing.name || '');
    if (!map.has(norm)) {
      map.set(norm, { ...ing, name: norm, amount: Number(ing.amount) || 1 });
    } else {
      const existing = map.get(norm)!;
      existing.amount += Number(ing.amount) || 1;
    }
  }
  return Array.from(map.values());
}
