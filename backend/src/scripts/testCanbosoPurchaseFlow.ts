/**
 * Canboso purchase pipeline diagnostic — live read-only API checks + purchase dry-run.
 * Does NOT call POST /purchase (no real debit).
 */
import type { SupplierProductMapping } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import {
  buildCanbosoPurchasePayload,
  canbosoAdapter,
  extractSupplierCostUsdFromRow,
  parseCanbosoPurchaseResult,
  type CanbosoCatalogProduct,
} from "../services/suppliers/adapters/CanbosoAdapter";
import { CANBOSO_SUPPLIER_NAME } from "../services/suppliers/CanbosoSyncService";
import {
  convertUsdToToman,
  DEFAULT_USD_TOMAN_RATE,
  exchangeRateService,
} from "../services/exchangeRateService";

const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

type StepOutcome = "SUCCESS" | "SKIPPED" | "FAILED";

type StepResult = {
  label: string;
  outcome: StepOutcome;
  detail: string;
};

const steps: StepResult[] = [];

function logStep(outcome: StepOutcome, label: string, detail: string): void {
  steps.push({ label, outcome, detail });
  const color =
    outcome === "SUCCESS" ? c.green : outcome === "SKIPPED" ? c.yellow : c.red;
  console.log(`${color}[${outcome}]${c.reset} ${label} ${c.dim}(${detail})${c.reset}`);
}

function hasUndefinedDeep(value: unknown): boolean {
  if (value === undefined) return true;
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => hasUndefinedDeep(entry));
  }
  return Object.values(value as Record<string, unknown>).some((entry) =>
    hasUndefinedDeep(entry),
  );
}

function validateSerializedPayload(payload: Record<string, unknown>): {
  ok: boolean;
  serialized: string;
  issues: string[];
} {
  const issues: string[] = [];
  if (hasUndefinedDeep(payload)) {
    issues.push("payload contains undefined values");
  }
  for (const [key, val] of Object.entries(payload)) {
    if (val === undefined) issues.push(`field "${key}" is undefined`);
    if (typeof val === "number" && !Number.isFinite(val)) {
      issues.push(`field "${key}" is not a finite number`);
    }
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch (err) {
    issues.push(
      `JSON.stringify failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { ok: false, serialized: "{}", issues };
  }
  if (serialized.includes("undefined")) {
    issues.push("serialized JSON contains literal undefined");
  }
  return { ok: issues.length === 0, serialized, issues };
}

function pickFirstActiveProduct(
  products: CanbosoCatalogProduct[],
): CanbosoCatalogProduct | null {
  const active = products.filter((p) => p.isAvailable && p.stock > 0);
  return active[0] ?? products[0] ?? null;
}

function validateProductSchema(product: CanbosoCatalogProduct): {
  ok: boolean;
  sample: string;
  issues: string[];
} {
  const issues: string[] = [];
  if (typeof product.productId !== "string" || !product.productId.trim()) {
    issues.push("productId missing or invalid");
  }
  if (typeof product.name !== "string" || !product.name.trim()) {
    issues.push("name missing or invalid");
  }
  if (typeof product.isAvailable !== "boolean") {
    issues.push("availability flag missing or invalid");
  }

  const raw =
    product.raw && typeof product.raw === "object"
      ? (product.raw as Record<string, unknown>)
      : {};
  const priceRaw = raw.price;
  let priceAmount: number | undefined;
  if (priceRaw !== null && typeof priceRaw === "object" && !Array.isArray(priceRaw)) {
    const amount = (priceRaw as Record<string, unknown>).amount;
    if (typeof amount === "number" && Number.isFinite(amount)) {
      priceAmount = amount;
    } else if (typeof amount === "string" && amount.trim()) {
      const n = Number(amount.replace(/,/g, ""));
      if (Number.isFinite(n)) priceAmount = n;
    }
  } else if (typeof priceRaw === "number" && Number.isFinite(priceRaw)) {
    priceAmount = priceRaw;
  }

  if (priceAmount == null && product.supplierCostUsd <= 0 && product.supplierPriceToman <= 0) {
    issues.push("price.amount / supplier cost not found");
  }

  const sample = [
    `id=${product.productId}`,
    `name=${product.name.slice(0, 48)}`,
    priceAmount != null ? `price.amount=${priceAmount}` : `costUsd=${product.supplierCostUsd}`,
    `available=${product.isAvailable}`,
    `stock=${product.stock}`,
  ].join(", ");

  return { ok: issues.length === 0, sample, issues };
}

function syntheticMappingFromCatalog(
  product: CanbosoCatalogProduct,
  supplierId: number,
): SupplierProductMapping {
  const supplierProductKey = product.parentProductId ?? product.productId;
  const supplierVariantKey =
    product.variantId && product.variantId !== supplierProductKey
      ? product.variantId
      : null;

  return {
    id: 0,
    productId: 0,
    supplierId,
    supplierProductKey,
    supplierVariantKey,
    maxPriceLimit: null,
    isAutoPurchase: true,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

function buildDryRunMockPurchaseResponse(product: CanbosoCatalogProduct): unknown {
  return {
    success: true,
    data: {
      order_id: `dry-run-${product.productId}-${Date.now()}`,
      cost: product.supplierCostUsd > 0 ? product.supplierCostUsd : 1,
      status: "completed",
      credentials: "DRY_RUN: credentials would appear here",
      message: "Simulated Canboso purchase response (no debit performed).",
    },
  };
}

async function run(): Promise<number> {
  console.log(`${c.bold}${"=".repeat(50)}${c.reset}`);
  console.log(`${c.cyan}${c.bold}🚀 CANBOSO API DIAGNOSTIC & PURCHASE DRY-RUN REPORT${c.reset}`);
  console.log(`${c.bold}${"=".repeat(50)}${c.reset}`);
  console.log(
    `${c.dim}Base URL: ${env.CANBOSO_BASE_URL} | API key: ${env.CANBOSO_API_KEY ? "configured" : "MISSING"}${c.reset}\n`,
  );

  let sampleProduct: CanbosoCatalogProduct | null = null;
  let productCount = 0;
  let criticalFailure = false;

  // —— Step 1: Authentication & connectivity (read-only catalog) ——
  try {
    canbosoAdapter.resolveApiKey();
    const products = await canbosoAdapter.getProducts();
    productCount = products.length;
    sampleProduct = pickFirstActiveProduct(products);
    logStep(
      "SUCCESS",
      "Step 1: Authentication & Connection",
      `HTTP 200 — catalog reachable (${productCount} SKU(s))`,
    );
  } catch (err) {
    criticalFailure = true;
    logStep(
      "FAILED",
      "Step 1: Authentication & Connection",
      err instanceof Error ? err.message : String(err),
    );
  }

  // —— Step 2: Balance / wallet ——
  try {
    const balance = await canbosoAdapter.getBalance();
    const currency = balance.currency ?? "unknown";
    logStep(
      "SUCCESS",
      "Step 2: Supplier Balance / Account Status",
      `balance=${balance.balance} ${currency}`,
    );
  } catch (err) {
    logStep(
      "SKIPPED",
      "Step 2: Supplier Balance / Account Status",
      `endpoint unavailable or error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // —— Step 3: Product schema ——
  if (!sampleProduct) {
    criticalFailure = true;
    logStep(
      "FAILED",
      "Step 3: Product Schema & Pricing Extraction",
      "no products returned from catalog",
    );
  } else {
    const schema = validateProductSchema(sampleProduct);
    if (schema.ok) {
      logStep(
        "SUCCESS",
        "Step 3: Product Schema & Pricing Extraction",
        `Sample: ${schema.sample}`,
      );
    } else {
      criticalFailure = true;
      logStep(
        "FAILED",
        "Step 3: Product Schema & Pricing Extraction",
        schema.issues.join("; "),
      );
    }
  }

  // —— Step 4: Purchase payload ——
  if (!sampleProduct) {
    logStep(
      "FAILED",
      "Step 4: Purchase Payload Construction & Validation",
      "skipped — no sample product",
    );
    criticalFailure = true;
  } else {
    const dryMapping = syntheticMappingFromCatalog(sampleProduct, 0);
    const customFields: Record<string, string> = {};
    for (const field of sampleProduct.requiredFields) {
      const key = field.toLowerCase().includes("email") ? "email" : field;
      customFields[key] =
        key.toLowerCase().includes("email")
          ? "dry-run@example.invalid"
          : "dry-run-value";
    }

    const payload = buildCanbosoPurchasePayload(dryMapping, {
      internalInvoiceId: 9_000_001,
      userInputData: Object.keys(customFields).length > 0 ? customFields : undefined,
    });

    const validation = validateSerializedPayload(payload);
    if (validation.ok) {
      logStep(
        "SUCCESS",
        "Step 4: Purchase Payload Construction & Validation",
        `POST /api/v2/telegram-buyer/purchase body: ${validation.serialized}`,
      );
    } else {
      criticalFailure = true;
      logStep(
        "FAILED",
        "Step 4: Purchase Payload Construction & Validation",
        validation.issues.join("; "),
      );
    }
  }

  // —— Step 5: Pipeline dry-run (DB mapping + pricing + mocked purchase) ——
  if (!sampleProduct) {
    logStep(
      "FAILED",
      "Step 5: Purchase Pipeline Dry-Run Simulation",
      "skipped — no sample product",
    );
    criticalFailure = true;
  } else {
    try {
      let mappingNote = "no local DB mapping (synthetic mapping used)";
      try {
        const supplier = await prisma.supplier.findFirst({
          where: {
            OR: [
              { name: CANBOSO_SUPPLIER_NAME },
              { name: { contains: "canboso", mode: "insensitive" } },
            ],
          },
        });

        if (supplier) {
          const supplierProductKey =
            sampleProduct.parentProductId ?? sampleProduct.productId;
          const dbMapping = await prisma.supplierProductMapping.findFirst({
            where: {
              supplierId: supplier.id,
              OR: [
                { supplierProductKey },
                { supplierVariantKey: sampleProduct.variantId ?? undefined },
                { supplierProductKey: sampleProduct.productId },
              ],
            },
            include: { product: true },
          });

          if (dbMapping) {
            mappingNote = `local product #${dbMapping.productId} "${dbMapping.product.name}" ↔ key ${dbMapping.supplierProductKey}`;
          } else {
            mappingNote = `supplier id=${supplier.id} has no mapping for SKU ${sampleProduct.productId}`;
          }
        } else {
          mappingNote = "Canboso supplier row not found in DB (synthetic mapping used)";
        }
      } catch (dbErr) {
        mappingNote = `DB check skipped: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`;
      }

      let usdRate = DEFAULT_USD_TOMAN_RATE;
      try {
        usdRate = await exchangeRateService.getUsdToTomanRate();
      } catch {
        /* use default */
      }

      const rawRow =
        sampleProduct.raw && typeof sampleProduct.raw === "object"
          ? (sampleProduct.raw as Record<string, unknown>)
          : {};
      const { costUsd } = extractSupplierCostUsdFromRow(rawRow, usdRate);
      const supplierCostUsd =
        costUsd > 0 ? costUsd : sampleProduct.supplierCostUsd > 0 ? sampleProduct.supplierCostUsd : 1;
      const retailToman = convertUsdToToman(supplierCostUsd, usdRate);

      const mappingForDryRun = syntheticMappingFromCatalog(sampleProduct, 1);
      const wouldSend = buildCanbosoPurchasePayload(mappingForDryRun, {
        internalInvoiceId: 9_000_002,
      });

      console.log(
        `${c.dim}  [DRY-RUN] Would POST ${env.CANBOSO_BASE_URL}/api/v2/telegram-buyer/purchase — NOT executed${c.reset}`,
      );
      console.log(`${c.dim}  [DRY-RUN] Body: ${JSON.stringify(wouldSend)}${c.reset}`);

      const mockBody = buildDryRunMockPurchaseResponse(sampleProduct);
      const parsed = parseCanbosoPurchaseResult(mockBody);

      if (!parsed.supplierOrderId || !parsed.deliveryPayload) {
        throw new Error("mock response parser returned incomplete PurchaseResult");
      }

      logStep(
        "SUCCESS",
        "Step 5: Purchase Pipeline Dry-Run Simulation",
        `${mappingNote} | costUsd≈${supplierCostUsd} retailToman≈${retailToman} | mock order ${parsed.supplierOrderId}`,
      );
    } catch (err) {
      criticalFailure = true;
      logStep(
        "FAILED",
        "Step 5: Purchase Pipeline Dry-Run Simulation",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log(`\n${c.bold}${"=".repeat(50)}${c.reset}`);
  const failed = steps.some((s) => s.outcome === "FAILED");
  if (!failed && !criticalFailure) {
    console.log(
      `${c.green}${c.bold}✅ OVERALL STATUS: CANBOSO PURCHASE API IS FULLY FUNCTIONAL${c.reset}`,
    );
  } else {
    console.log(
      `${c.red}${c.bold}❌ OVERALL STATUS: CANBOSO PURCHASE API NEEDS ATTENTION${c.reset}`,
    );
  }
  console.log(`${c.bold}${"=".repeat(50)}${c.reset}`);

  await prisma.$disconnect().catch(() => undefined);

  return failed || criticalFailure ? 1 : 0;
}

run()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
