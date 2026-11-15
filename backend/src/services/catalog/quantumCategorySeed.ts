import { QUANTUM_SUPPLIER_NAME } from "../suppliers/quantumvault/quantumCatalog";

/**
 * Idempotent Quantum category merge. Matches production rows by id and name,
 * moves products, and never deletes a product or a subcategory.
 * Customer shop already hides an active category until it has an active product.
 */

export const AI_API_CATEGORY_NAME = "🔌 API هوش مصنوعی";
export const SOCIAL_CATEGORY_NAME = "📱 شبکه‌های اجتماعی و شماره مجازی";
export const AI_API_CATEGORY_DESCRIPTION = "کلید API مدل‌های هوش مصنوعی";
export const SOCIAL_CATEGORY_DESCRIPTION = "شبکه‌های اجتماعی و شماره مجازی";

/** Production categories the seed must not rewrite. */
export const PROTECTED_CATEGORY_IDS = [3, 4, 5, 12] as const;

const CAT = {
  ai: 1,
  design: 6,
  film: 7,
  dev: 8,
  vpn: 9,
  edu: 10,
  mail: 11,
  apple: 13,
} as const;

const SUB = {
  deepseek: "DeepSeek | دیپ‌سیک",
  kling: "Kling | کلینگ",
  heygen: "HeyGen | هی‌جن",
  qwen: "Qwen | کوئن",
  seedance: "Seedance | سیدانس",
  kimi: "Kimi | کیمی",
  minimax: "MiniMax | مینی‌مکس",
  manus: "Manus | مانوس",
  openart: "OpenArt | اوپن‌آرت",
  moreAi: "More AI | سایر ابزارهای AI",
  openaiApi: "OpenAI / Codex API | اوپن‌ای‌آی / کدکس",
  claudeApi: "Claude API | کلود API",
  grokApi: "Grok API | گروک API",
  imageApi: "AI Image & Video API | API تصویر و ویدیو",
  tryclico: "Tryclico | ترای‌کلیکو",
  jetbrains: "JetBrains | جت‌برینز",
  replit: "Replit | ریپلیت",
  railway: "Railway | ریل‌وی",
  framer: "Framer | فریمر",
  gpm: "GPM Login | جی‌پی‌ام لاگین",
  devCloud: "Dev & Cloud | توسعه و کلود",
  hma: "HMA VPN | اچ‌ام‌ای",
  kaspersky: "Kaspersky | کسپرسکی",
  moreVpn: "More VPN | سایر VPN ها",
  scribd: "Scribd | اسکریبد",
  quizlet: "Quizlet | کوییزلت",
  kahoot: "Kahoot | کاهوت",
  learning: "Learning | سایر آموزشی",
  windows: "Windows & Office | ویندوز و آفیس",
  tiktok: "TikTok | تیک‌تاک",
  x: "X (Twitter) | ایکس (توییتر)",
  otp: "OTP Numbers | شماره مجازی",
  veo: "Veo3 / Antigravity | ویو۳",
  figma: "Figma | فیگما",
  proton: "Proton VPN | پروتون",
  express: "ExpressVPN | اکسپرس",
  ilovepdf: "iLovePDF | آی‌لاوپی‌دی‌اف",
} as const;

export type SeedCategory = {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  isAdminManaged: boolean;
};

export type SeedSubCategory = {
  id: number;
  name: string;
  categoryId: number;
  isActive: boolean;
  isAdminManaged: boolean;
  sortOrder: number;
};

export type SeedProduct = {
  id: number;
  name: string;
  categoryId: number;
  subCategoryId: number | null;
};

export type SeedPending = {
  id: number;
  categoryId: number | null;
  subCategoryId: number | null;
};

export type SeedMapping = {
  id: number;
  supplierId: number;
  remoteFolder: string;
  categoryId: number;
  subCategoryId: number | null;
};

export type SeedSupplier = {
  id: number;
  name: string;
  isActive: boolean;
};

export type SeedSnapshot = {
  categories: SeedCategory[];
  subCategories: SeedSubCategory[];
  products: SeedProduct[];
  pending: SeedPending[];
  mappings: SeedMapping[];
  suppliers: SeedSupplier[];
};

export type SeedPlan = {
  next: SeedSnapshot;
  logs: string[];
  changes: number;
  skipped: number;
};

type CategorySpec = { id: number; tokens: string[] };
type SubSpec = { id: number; categoryId: number; tokens: string[]; targetName?: string };
type NewSubSpec = { key: string; categoryId?: number; categoryName?: string; name: string };
type FolderSpec = {
  folder: string;
  categoryId?: number;
  categoryName?: string;
  subCategoryId?: number;
  subCategoryName?: string;
};

const PROTECTED = new Set<number>(PROTECTED_CATEGORY_IDS);

const CATEGORY_SPECS: Record<number, CategorySpec> = {
  [CAT.ai]: { id: CAT.ai, tokens: ["هوش مصنوعی"] },
  [CAT.design]: { id: CAT.design, tokens: ["طراحی"] },
  [CAT.film]: { id: CAT.film, tokens: ["فیلم"] },
  [CAT.dev]: { id: CAT.dev, tokens: ["برنامه"] },
  [CAT.vpn]: { id: CAT.vpn, tokens: ["امنیت", "vpn"] },
  [CAT.edu]: { id: CAT.edu, tokens: ["آموزش"] },
  [CAT.mail]: { id: CAT.mail, tokens: ["جیمیل"] },
  [CAT.apple]: { id: CAT.apple, tokens: ["اپل", "آیکلود"] },
};

const RENAMES: SubSpec[] = [
  { id: 130, categoryId: CAT.ai, tokens: ["veo", "antigravity", "ویو"], targetName: SUB.veo },
  { id: 132, categoryId: CAT.design, tokens: ["figma", "فیگما"], targetName: SUB.figma },
  { id: 134, categoryId: CAT.vpn, tokens: ["proton", "پروتون"], targetName: SUB.proton },
  { id: 135, categoryId: CAT.vpn, tokens: ["express", "اکسپرس"], targetName: SUB.express },
  { id: 131, categoryId: CAT.edu, tokens: ["ilovepdf", "آی‌لاو", "آی لاو"], targetName: SUB.ilovepdf },
];

const MERGES: Array<{ from: SubSpec; toId: number }> = [
  { from: { id: 136, categoryId: CAT.ai, tokens: ["admin"] }, toId: 130 },
  { from: { id: 133, categoryId: CAT.design, tokens: ["edu", "آموزش"] }, toId: 132 },
];

const NEW_SUBS: NewSubSpec[] = [
  { key: "deepseek", categoryId: CAT.ai, name: SUB.deepseek },
  { key: "kling", categoryId: CAT.ai, name: SUB.kling },
  { key: "heygen", categoryId: CAT.ai, name: SUB.heygen },
  { key: "qwen", categoryId: CAT.ai, name: SUB.qwen },
  { key: "seedance", categoryId: CAT.ai, name: SUB.seedance },
  { key: "kimi", categoryId: CAT.ai, name: SUB.kimi },
  { key: "minimax", categoryId: CAT.ai, name: SUB.minimax },
  { key: "manus", categoryId: CAT.ai, name: SUB.manus },
  { key: "openart", categoryId: CAT.ai, name: SUB.openart },
  { key: "moreAi", categoryId: CAT.ai, name: SUB.moreAi },
  { key: "openaiApi", categoryName: AI_API_CATEGORY_NAME, name: SUB.openaiApi },
  { key: "claudeApi", categoryName: AI_API_CATEGORY_NAME, name: SUB.claudeApi },
  { key: "grokApi", categoryName: AI_API_CATEGORY_NAME, name: SUB.grokApi },
  { key: "imageApi", categoryName: AI_API_CATEGORY_NAME, name: SUB.imageApi },
  { key: "tryclico", categoryId: CAT.design, name: SUB.tryclico },
  { key: "jetbrains", categoryId: CAT.dev, name: SUB.jetbrains },
  { key: "replit", categoryId: CAT.dev, name: SUB.replit },
  { key: "railway", categoryId: CAT.dev, name: SUB.railway },
  { key: "framer", categoryId: CAT.dev, name: SUB.framer },
  { key: "gpm", categoryId: CAT.dev, name: SUB.gpm },
  { key: "devCloud", categoryId: CAT.dev, name: SUB.devCloud },
  { key: "hma", categoryId: CAT.vpn, name: SUB.hma },
  { key: "kaspersky", categoryId: CAT.vpn, name: SUB.kaspersky },
  { key: "moreVpn", categoryId: CAT.vpn, name: SUB.moreVpn },
  { key: "scribd", categoryId: CAT.edu, name: SUB.scribd },
  { key: "quizlet", categoryId: CAT.edu, name: SUB.quizlet },
  { key: "kahoot", categoryId: CAT.edu, name: SUB.kahoot },
  { key: "learning", categoryId: CAT.edu, name: SUB.learning },
  { key: "windows", categoryId: CAT.mail, name: SUB.windows },
  { key: "tiktok", categoryName: SOCIAL_CATEGORY_NAME, name: SUB.tiktok },
  { key: "x", categoryName: SOCIAL_CATEGORY_NAME, name: SUB.x },
  { key: "otp", categoryName: SOCIAL_CATEGORY_NAME, name: SUB.otp },
];

function toId(folders: string[], categoryId: number, subCategoryId: number): FolderSpec[] {
  return folders.map((folder) => ({ folder, categoryId, subCategoryId }));
}

function toName(
  folders: string[],
  categoryId: number | undefined,
  categoryName: string | undefined,
  subCategoryName: string,
): FolderSpec[] {
  return folders.map((folder) => ({ folder, categoryId, categoryName, subCategoryName }));
}

const FOLDER_MAPPINGS: FolderSpec[] = [
  ...toId(
    [
      "ChatGPT Plus",
      "ChatGPT Go",
      "ChatGPT Pro",
      "ChatGPT Business (Team)",
      "ChatGPT",
      "ChatGPT Edu",
      "Codex OTP",
    ],
    CAT.ai,
    101,
  ),
  ...toId(["Claude"], CAT.ai, 106),
  ...toId(["Grok"], CAT.ai, 105),
  ...toId(["Gemini"], CAT.ai, 104),
  ...toId(["ElevenLabs"], CAT.ai, 107),
  ...toId(["Gamma"], CAT.ai, 109),
  ...toId(["Perplexity"], CAT.ai, 110),
  ...toId(["Lovable"], CAT.ai, 111),
  ...toId(["Suno"], CAT.ai, 112),
  ...toId(["Higgsfield"], CAT.ai, 121),
  ...toId(["Muse AI"], CAT.ai, 127),
  ...toId(["Freepik"], CAT.ai, 129),
  ...toId(["Zoom"], CAT.ai, 102),
  ...toId(["Antigravity (Veo3)"], CAT.ai, 130),
  ...toName(["DeepSeek"], CAT.ai, undefined, SUB.deepseek),
  ...toName(["Kling"], CAT.ai, undefined, SUB.kling),
  ...toName(["HeyGen"], CAT.ai, undefined, SUB.heygen),
  ...toName(["Qwen"], CAT.ai, undefined, SUB.qwen),
  ...toName(["Seedance"], CAT.ai, undefined, SUB.seedance),
  ...toName(["Kimi"], CAT.ai, undefined, SUB.kimi),
  ...toName(["MiniMax"], CAT.ai, undefined, SUB.minimax),
  ...toName(["Manus"], CAT.ai, undefined, SUB.manus),
  ...toName(["OpenArt"], CAT.ai, undefined, SUB.openart),
  ...toName(["More AI"], CAT.ai, undefined, SUB.moreAi),
  ...toName(["Codex API"], undefined, AI_API_CATEGORY_NAME, SUB.openaiApi),
  ...toName(["Claude API"], undefined, AI_API_CATEGORY_NAME, SUB.claudeApi),
  ...toName(["Grok API"], undefined, AI_API_CATEGORY_NAME, SUB.grokApi),
  ...toName(["AI Image API", "Muse AI Video API"], undefined, AI_API_CATEGORY_NAME, SUB.imageApi),
  ...toId(["Cursor API", "Cursor"], CAT.dev, 69),
  ...toId(["Capcut"], CAT.design, 84),
  ...toId(["Adobe"], CAT.design, 75),
  ...toId(["Canva"], CAT.design, 80),
  ...toId(["Meitu"], CAT.design, 117),
  ...toId(["Wink"], CAT.design, 119),
  ...toId(["Xingtu"], CAT.design, 120),
  ...toId(["Figma"], CAT.design, 132),
  ...toName(["Tryclico"], CAT.design, undefined, SUB.tryclico),
  ...toId(["YouTube"], CAT.film, 93),
  ...toId(["Notion"], CAT.dev, 89),
  ...toName(["JetBrains"], CAT.dev, undefined, SUB.jetbrains),
  ...toName(["Replit"], CAT.dev, undefined, SUB.replit),
  ...toName(["Railway"], CAT.dev, undefined, SUB.railway),
  ...toName(["Framer"], CAT.dev, undefined, SUB.framer),
  ...toName(["GPM Login"], CAT.dev, undefined, SUB.gpm),
  ...toName(["Dev & cloud"], CAT.dev, undefined, SUB.devCloud),
  ...toId(["NordVPN"], CAT.vpn, 83),
  ...toId(["Surfshark"], CAT.vpn, 98),
  ...toId(["ExpressVPN"], CAT.vpn, 135),
  ...toId(["Proton"], CAT.vpn, 134),
  ...toName(["HMA VPN"], CAT.vpn, undefined, SUB.hma),
  ...toName(["Kaspersky"], CAT.vpn, undefined, SUB.kaspersky),
  ...toName(["More VPN"], CAT.vpn, undefined, SUB.moreVpn),
  ...toId(["Udemy"], CAT.edu, 70),
  ...toId(["Duolingo"], CAT.edu, 81),
  ...toId(["Coursera"], CAT.edu, 82),
  ...toId(["Grammarly"], CAT.edu, 90),
  ...toId(["iLovePDF"], CAT.edu, 131),
  ...toName(["Scribd"], CAT.edu, undefined, SUB.scribd),
  ...toName(["Quizlet"], CAT.edu, undefined, SUB.quizlet),
  ...toName(["Kahoot"], CAT.edu, undefined, SUB.kahoot),
  ...toName(["Learning"], CAT.edu, undefined, SUB.learning),
  ...toId(["Gmail"], CAT.mail, 94),
  ...toId(["Outlook Mail"], CAT.mail, 122),
  ...toId(["Microsoft 365"], CAT.mail, 88),
  ...toName(["Windows & Office"], CAT.mail, undefined, SUB.windows),
  ...toId(["iCloud"], CAT.apple, 99),
  ...toName(["TikTok"], undefined, SOCIAL_CATEGORY_NAME, SUB.tiktok),
  ...toName(["X (Twitter)"], undefined, SOCIAL_CATEGORY_NAME, SUB.x),
  ...toName(["OTP Numbers"], undefined, SOCIAL_CATEGORY_NAME, SUB.otp),
];

function folderKey(value: string): string {
  return value.trim().toLowerCase();
}

function nameMatches(name: string, tokens: string[], targetName?: string): boolean {
  if (targetName && name.trim() === targetName) return true;
  const haystack = name.toLowerCase();
  return tokens.some((token) => haystack.includes(token.toLowerCase()));
}

export function planQuantumCategorySeed(input: SeedSnapshot): SeedPlan {
  const next = structuredClone(input);
  const logs: string[] = [];
  let changes = 0;
  let skipped = 0;
  let temp = -1;
  const tag = "[quantum-categories]";

  const change = (message: string) => {
    changes += 1;
    logs.push(`${tag} ${message}`);
  };
  const categoryLabel = (category: SeedCategory): string =>
    category.id < 0 ? `(new) ${category.name}` : `#${category.id} ${category.name}`;
  const skip = (message: string) => {
    skipped += 1;
    logs.push(`${tag} skip: ${message}`);
  };

  const findCategory = (spec: CategorySpec, label: string): SeedCategory | null => {
    const byId = next.categories.find((row) => row.id === spec.id);
    if (byId && PROTECTED.has(byId.id)) {
      skip(`${label}: category #${spec.id} is protected`);
      return null;
    }
    if (byId && nameMatches(byId.name, spec.tokens)) return byId;
    if (byId) {
      skip(`${label}: category #${spec.id} is named "${byId.name}"`);
      return null;
    }
    const matches = next.categories.filter(
      (row) => !PROTECTED.has(row.id) && nameMatches(row.name, spec.tokens),
    );
    if (matches.length === 1) {
      logs.push(`${tag} note: ${label} category #${spec.id} missing, using #${matches[0]!.id}`);
      return matches[0]!;
    }
    skip(`${label}: category #${spec.id} not found`);
    return null;
  };

  const findSub = (spec: SubSpec, label: string): SeedSubCategory | null => {
    const byId = next.subCategories.find((row) => row.id === spec.id);
    if (byId && PROTECTED.has(byId.categoryId)) {
      skip(`${label}: subcategory #${spec.id} is under protected category #${byId.categoryId}`);
      return null;
    }
    if (
      byId &&
      byId.categoryId === spec.categoryId &&
      nameMatches(byId.name, spec.tokens, spec.targetName)
    ) {
      return byId;
    }
    if (byId && byId.categoryId !== spec.categoryId) {
      skip(
        `${label}: subcategory #${spec.id} "${byId.name}" is in category #${byId.categoryId}, expected #${spec.categoryId}`,
      );
      return null;
    }
    if (byId) {
      skip(`${label}: subcategory #${spec.id} is named "${byId.name}"`);
      return null;
    }
    const matches = next.subCategories.filter(
      (row) =>
        row.categoryId === spec.categoryId &&
        !PROTECTED.has(row.categoryId) &&
        nameMatches(row.name, spec.tokens, spec.targetName),
    );
    if (matches.length === 1) {
      logs.push(
        `${tag} note: ${label} subcategory #${spec.id} missing, using #${matches[0]!.id} "${matches[0]!.name}"`,
      );
      return matches[0]!;
    }
    skip(`${label}: subcategory #${spec.id} not found`);
    return null;
  };

  const findSubInCategory = (
    id: number,
    categoryId: number,
    label: string,
  ): SeedSubCategory | null => {
    const byId = next.subCategories.find((row) => row.id === id);
    if (!byId) {
      skip(`${label}: subcategory #${id} not found`);
      return null;
    }
    if (PROTECTED.has(byId.categoryId) || byId.categoryId !== categoryId) {
      skip(
        `${label}: subcategory #${id} "${byId.name}" is in category #${byId.categoryId}, expected #${categoryId}`,
      );
      return null;
    }
    return byId;
  };

  for (const merge of MERGES) {
    const targetSpec = RENAMES.find((row) => row.id === merge.toId);
    const target = targetSpec ? findSub(targetSpec, `merge into #${merge.toId}`) : null;
    const source = findSub(merge.from, `merge #${merge.from.id}`);
    if (!target || !source || target.id === source.id) continue;

    const moving = next.products.filter((product) => product.subCategoryId === source.id);
    const moved: SeedProduct[] = [];
    for (const product of moving) {
      if (PROTECTED.has(product.categoryId)) {
        skip(`product #${product.id} stays in protected category #${product.categoryId}`);
        continue;
      }
      product.categoryId = target.categoryId;
      product.subCategoryId = target.id;
      moved.push(product);
    }
    if (moved.length > 0) {
      change(
        `move ${moved.length} products from subcategory #${source.id} "${source.name}" to #${target.id}: ${moved
          .map((product) => `#${product.id} ${product.name}`)
          .join(", ")}`,
      );
    }

    const imports = next.pending.filter((row) => row.subCategoryId === source.id);
    if (imports.length > 0) {
      for (const row of imports) {
        row.categoryId = target.categoryId;
        row.subCategoryId = target.id;
      }
      change(`retarget ${imports.length} import rows from subcategory #${source.id} to #${target.id}`);
    }

    const pointed = next.mappings.filter((row) => row.subCategoryId === source.id);
    if (pointed.length > 0) {
      for (const row of pointed) {
        row.categoryId = target.categoryId;
        row.subCategoryId = target.id;
      }
      change(`retarget ${pointed.length} folder mappings from subcategory #${source.id} to #${target.id}`);
    }

    const remaining = next.products.filter((product) => product.subCategoryId === source.id).length;
    if (remaining === 0 && source.isActive) {
      source.isActive = false;
      change(`deactivate emptied subcategory #${source.id} "${source.name}"`);
    } else if (remaining > 0) {
      skip(`subcategory #${source.id} still has ${remaining} products, left active`);
    }
  }

  for (const rename of RENAMES) {
    const sub = findSub(rename, `rename #${rename.id}`);
    if (!sub || !rename.targetName || sub.name === rename.targetName) continue;
    const from = sub.name;
    sub.name = rename.targetName;
    change(`rename subcategory #${sub.id} "${from}" -> "${rename.targetName}"`);
  }

  const createdCategories = new Map<string, SeedCategory>();
  const ensureCategory = (name: string, description: string): SeedCategory | null => {
    const existing =
      createdCategories.get(name) ?? next.categories.find((row) => row.name === name);
    if (existing) {
      if (PROTECTED.has(existing.id)) {
        skip(`refusing to reuse protected category #${existing.id} for "${name}"`);
        return null;
      }
      if (!existing.isAdminManaged) {
        existing.isAdminManaged = true;
        change(`mark category #${existing.id} "${name}" admin-managed so empty-category purge keeps it`);
      }
      if (!existing.description) {
        existing.description = description;
        change(`set description on category #${existing.id} "${name}"`);
      }
      createdCategories.set(name, existing);
      return existing;
    }
    const created: SeedCategory = {
      id: temp--,
      name,
      description,
      isActive: true,
      isAdminManaged: true,
    };
    next.categories.push(created);
    createdCategories.set(name, created);
    change(`create category "${name}" (active; shop hides it until it has an active product)`);
    return created;
  };

  const apiCategory = ensureCategory(AI_API_CATEGORY_NAME, AI_API_CATEGORY_DESCRIPTION);
  const socialCategory = ensureCategory(SOCIAL_CATEGORY_NAME, SOCIAL_CATEGORY_DESCRIPTION);

  const createdSubs = new Map<string, SeedSubCategory>();
  for (const spec of NEW_SUBS) {
    const category = spec.categoryId
      ? findCategory(CATEGORY_SPECS[spec.categoryId]!, spec.name)
      : spec.categoryName === AI_API_CATEGORY_NAME
        ? apiCategory
        : spec.categoryName === SOCIAL_CATEGORY_NAME
          ? socialCategory
          : null;
    if (!category) {
      skip(`subcategory "${spec.name}" has no parent category`);
      continue;
    }
    const existing = next.subCategories.find(
      (row) => row.categoryId === category.id && row.name.trim() === spec.name,
    );
    if (existing) {
      if (PROTECTED.has(existing.categoryId)) {
        skip(`subcategory "${spec.name}" is under protected category #${existing.categoryId}`);
        continue;
      }
      if (!existing.isAdminManaged) {
        existing.isAdminManaged = true;
        change(`mark subcategory #${existing.id} "${spec.name}" admin-managed`);
      }
      if (!existing.isActive) {
        existing.isActive = true;
        change(`reactivate subcategory #${existing.id} "${spec.name}"`);
      }
      createdSubs.set(spec.name, existing);
      continue;
    }
    const sortOrder =
      next.subCategories
        .filter((row) => row.categoryId === category.id)
        .reduce((max, row) => Math.max(max, row.sortOrder), 0) + 1;
    const created: SeedSubCategory = {
      id: temp--,
      name: spec.name,
      categoryId: category.id,
      isActive: true,
      isAdminManaged: true,
      sortOrder,
    };
    next.subCategories.push(created);
    createdSubs.set(spec.name, created);
    change(`create subcategory "${spec.name}" in category ${categoryLabel(category)}`);
  }

  let supplier = next.suppliers.find((row) => row.name === QUANTUM_SUPPLIER_NAME);
  if (!supplier) {
    supplier = { id: temp--, name: QUANTUM_SUPPLIER_NAME, isActive: true };
    next.suppliers.push(supplier);
    change(`create supplier "${QUANTUM_SUPPLIER_NAME}"`);
  }

  for (const spec of FOLDER_MAPPINGS) {
    const canonical = spec.folder.trim();
    if (!canonical || folderKey(canonical) === "other") {
      skip(`folder "${spec.folder}" is left unmapped`);
      continue;
    }
    const category = spec.categoryId
      ? findCategory(CATEGORY_SPECS[spec.categoryId]!, canonical)
      : spec.categoryName
        ? (createdCategories.get(spec.categoryName) ??
          next.categories.find((row) => row.name === spec.categoryName) ??
          null)
        : null;
    if (!category) continue;
    const sub = spec.subCategoryId
      ? findSubInCategory(spec.subCategoryId, category.id, canonical)
      : spec.subCategoryName
        ? (createdSubs.get(spec.subCategoryName) ??
          next.subCategories.find(
            (row) => row.categoryId === category.id && row.name === spec.subCategoryName,
          ) ??
          null)
        : null;
    if (!sub) {
      if (!spec.subCategoryId) skip(`folder "${canonical}" has no subcategory "${spec.subCategoryName}"`);
      continue;
    }

    const matches = next.mappings
      .filter(
        (row) =>
          row.supplierId === supplier.id && folderKey(row.remoteFolder) === folderKey(canonical),
      )
      .sort((a, b) => a.id - b.id);
    const keep = matches[0];
    if (!keep) {
      next.mappings.push({
        id: temp--,
        supplierId: supplier.id,
        remoteFolder: canonical,
        categoryId: category.id,
        subCategoryId: sub.id,
      });
      change(`map "${canonical}" -> category ${categoryLabel(category)} / ${sub.name}`);
      continue;
    }
    for (const extra of matches.slice(1)) {
      next.mappings = next.mappings.filter((row) => row.id !== extra.id);
      change(`remove duplicate folder mapping #${extra.id} "${extra.remoteFolder}"`);
    }
    if (
      keep.remoteFolder !== canonical ||
      keep.categoryId !== category.id ||
      keep.subCategoryId !== sub.id
    ) {
      keep.remoteFolder = canonical;
      keep.categoryId = category.id;
      keep.subCategoryId = sub.id;
      change(`update "${canonical}" -> category ${categoryLabel(category)} / ${sub.name}`);
    }
  }

  logs.push(`${tag} summary: ${changes} changes, ${skipped} skipped`);
  return { next, logs, changes, skipped };
}

/** Production-shaped tree used by the dry-run test. Ids match the live shop. */
export function productionLikeFixture(): SeedSnapshot {
  const category = (
    id: number,
    name: string,
    isActive: boolean,
  ): SeedCategory => ({
    id,
    name,
    description: null,
    isActive,
    isAdminManaged: false,
  });
  const sub = (id: number, categoryId: number, name: string): SeedSubCategory => ({
    id,
    name,
    categoryId,
    isActive: true,
    isAdminManaged: false,
    sortOrder: 0,
  });

  return {
    categories: [
      category(1, "🤖 ابزارهای هوش مصنوعی", true),
      category(3, "دسته خالی ۳", false),
      category(4, "دسته خالی ۴", false),
      category(5, "دسته خالی ۵", false),
      category(6, "🎨 طراحی و ادیت", true),
      category(7, "🎬 فیلم و موسیقی", true),
      category(8, "💻 برنامه‌نویسی و وب", true),
      category(9, "🛡 امنیت و VPN", true),
      category(10, "🎓 آموزش و مهارت", true),
      category(11, "📧 جیمیل و آفیس", true),
      category(12, "🚀 خدمات تلگرام", true),
      category(13, "🍏 اپل آیدی و آیکلود", true),
    ],
    subCategories: [
      sub(101, 1, "ChatGPT | چت‌جی‌پی‌تی"),
      sub(102, 1, "Zoom | زوم"),
      sub(104, 1, "Gemini | جمنای"),
      sub(105, 1, "Grok | گروک"),
      sub(106, 1, "Claude | کلود"),
      sub(107, 1, "ElevenLabs | الون‌لبز"),
      sub(109, 1, "Gamma | گاما"),
      sub(110, 1, "Perplexity | پرپلکسیتی"),
      sub(111, 1, "Lovable | لاوابل"),
      sub(112, 1, "Suno | سونو"),
      sub(121, 1, "Higgsfield | هیگزفیلد"),
      sub(127, 1, "Muse AI | میوز"),
      sub(129, 1, "Freepik | فری‌پیک"),
      sub(130, 1, "🚀 VEO3 | ویو"),
      sub(136, 1, "🚀 ADMIN VEO3 X20 | ادمین"),
      sub(69, 8, "Cursor | کرسر"),
      sub(75, 6, "Adobe | ادوبی"),
      sub(80, 6, "Canva | کانوا"),
      sub(84, 6, "CapCut | کپ‌کات"),
      sub(117, 6, "Meitu | میتو"),
      sub(119, 6, "Wink | وینک"),
      sub(120, 6, "Xingtu | شینگ‌تو"),
      sub(132, 6, "Figma Pro | فیگما"),
      sub(133, 6, "Figma Pro Edu | فیگما آموزشی"),
      sub(93, 7, "YouTube | یوتیوب"),
      sub(89, 8, "Notion | نوشن"),
      sub(83, 9, "NordVPN | نورد"),
      sub(98, 9, "Surfshark | سرف‌شارک"),
      sub(134, 9, "Proton | پروتون"),
      sub(135, 9, "Express | اکسپرس"),
      sub(70, 10, "Udemy | یودمی"),
      sub(81, 10, "Duolingo | دولینگو"),
      sub(82, 10, "Coursera | کورسرا"),
      sub(90, 10, "Grammarly | گرامرلی"),
      sub(131, 10, "iLovePDF"),
      sub(94, 11, "Gmail | جیمیل"),
      sub(122, 11, "Outlook | اوت‌لوک"),
      sub(88, 11, "Microsoft 365 | مایکروسافت ۳۶۵"),
      sub(99, 13, "iCloud | آی‌کلود"),
      sub(201, 12, "Telegram Stars | استارز تلگرام"),
    ],
    products: [
      { id: 501, name: "ADMIN VEO3 X20 اکانت", categoryId: 1, subCategoryId: 136 },
      { id: 502, name: "ADMIN VEO3 X20 دوم", categoryId: 1, subCategoryId: 136 },
      { id: 503, name: "Figma Pro Edu سالانه", categoryId: 6, subCategoryId: 133 },
      { id: 504, name: "ChatGPT Plus", categoryId: 1, subCategoryId: 101 },
      { id: 505, name: "Telegram Stars 100", categoryId: 12, subCategoryId: 201 },
    ],
    pending: [
      { id: 1, categoryId: 1, subCategoryId: 136 },
      { id: 2, categoryId: 6, subCategoryId: 133 },
    ],
    mappings: [
      {
        id: 9,
        supplierId: 2,
        remoteFolder: "chatgpt plus",
        categoryId: 1,
        subCategoryId: 102,
      },
    ],
    suppliers: [{ id: 2, name: QUANTUM_SUPPLIER_NAME, isActive: true }],
  };
}
