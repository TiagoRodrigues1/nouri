import type { AppDatabase } from "../db/database.js";
import { searchFoods } from "./catalog.js";
import { communityProduct, searchCommunityFoods } from "./community.js";
import type { SearchResult } from "./contract.js";
import type { PackagedFoods, PackagedLookup } from "./packaged.js";

// Foods matching a name: up to five community foods the person can see, then Ciqual's. Community foods are mostly
// branded, and someone typing a brand wants it, so they come first rather than ranked against Ciqual's scores.
export async function findFoods(db: AppDatabase, userId: string, query: string, locale: string): Promise<SearchResult> {
  const community = await searchCommunityFoods(db, userId, query);
  const catalog = searchFoods(query, locale);

  return { items: [...community, ...catalog.items], attribution: catalog.attribution };
}

// The product with this barcode. A food someone added to Nouri answers before Open Food Facts is asked; it is
// Nouri's own data, carrying its "nouri" reference, so it credits no provider.
export async function findByBarcode(db: AppDatabase, packagedFoods: PackagedFoods, userId: string, barcode: string): Promise<PackagedLookup> {
  const community = await communityProduct(db, userId, barcode);

  if (community) return { outcome: "found", result: { product: community, attribution: [] } };

  return packagedFoods.lookup(barcode);
}
