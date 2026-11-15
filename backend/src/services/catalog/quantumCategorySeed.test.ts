import assert from "node:assert/strict";
import test from "node:test";
import { SHOP_TAXONOMY } from "./brandCatalog.js";
import {
  AI_API_CATEGORY_NAME,
  planQuantumCategorySeed,
  productionLikeFixture,
  PROTECTED_CATEGORY_IDS,
  SOCIAL_CATEGORY_NAME,
} from "./quantumCategorySeed.js";

test("quantum category seed dry-run merges duplicates and maps folders once", () => {
  const fixture = productionLikeFixture();
  const plan = planQuantumCategorySeed(fixture);
  console.log(plan.logs.join("\n"));

  assert.equal(plan.skipped, 0);
  assert.ok(plan.changes > 0);
  assert.deepEqual(
    plan.next.products.map((row) => row.id).sort((a, b) => a - b),
    fixture.products.map((row) => row.id).sort((a, b) => a - b),
  );

  const movedVeo = plan.next.products.filter((row) => row.id === 501 || row.id === 502);
  assert.ok(movedVeo.every((row) => row.subCategoryId === 130 && row.categoryId === 1));
  const figma = plan.next.products.find((row) => row.id === 503);
  assert.equal(figma?.subCategoryId, 132);
  assert.equal(figma?.categoryId, 6);
  assert.equal(plan.next.products.find((row) => row.id === 504)?.subCategoryId, 101);
  assert.equal(plan.next.products.find((row) => row.id === 505)?.categoryId, 12);

  assert.equal(plan.next.subCategories.find((row) => row.id === 130)?.name, "Veo3 / Antigravity | ویو۳");
  assert.equal(plan.next.subCategories.find((row) => row.id === 132)?.name, "Figma | فیگما");
  assert.equal(plan.next.subCategories.find((row) => row.id === 134)?.name, "Proton VPN | پروتون");
  assert.equal(plan.next.subCategories.find((row) => row.id === 135)?.name, "ExpressVPN | اکسپرس");
  assert.equal(plan.next.subCategories.find((row) => row.id === 131)?.name, "iLovePDF | آی‌لاوپی‌دی‌اف");
  assert.equal(plan.next.subCategories.find((row) => row.id === 136)?.isActive, false);
  assert.equal(plan.next.subCategories.find((row) => row.id === 133)?.isActive, false);
  assert.ok(plan.next.subCategories.some((row) => row.id === 136));
  assert.ok(plan.next.subCategories.some((row) => row.id === 133));

  for (const id of PROTECTED_CATEGORY_IDS) {
    assert.deepEqual(
      plan.next.categories.find((row) => row.id === id),
      fixture.categories.find((row) => row.id === id),
    );
  }
  assert.deepEqual(
    plan.next.subCategories.find((row) => row.id === 201),
    fixture.subCategories.find((row) => row.id === 201),
  );

  const api = plan.next.categories.find((row) => row.name === AI_API_CATEGORY_NAME);
  const social = plan.next.categories.find((row) => row.name === SOCIAL_CATEGORY_NAME);
  assert.equal(api?.isActive, true);
  assert.equal(api?.isAdminManaged, true);
  assert.equal(social?.isActive, true);
  assert.ok(plan.next.subCategories.some((row) => row.name === "More AI | سایر ابزارهای AI" && row.isAdminManaged));
  assert.ok(plan.next.subCategories.some((row) => row.name === "OTP Numbers | شماره مجازی"));

  const chat = plan.next.mappings.find((row) => row.remoteFolder === "ChatGPT Plus");
  assert.equal(chat?.subCategoryId, 101);
  assert.equal(
    plan.next.mappings.filter((row) => row.remoteFolder.toLowerCase() === "chatgpt plus").length,
    1,
  );
  const devCloud = plan.next.mappings.find((row) => row.remoteFolder === "Dev & cloud");
  const devSub = plan.next.subCategories.find((row) => row.id === devCloud?.subCategoryId);
  assert.equal(devSub?.name, "Dev & Cloud | توسعه و کلود");
  assert.equal(
    plan.next.mappings.some((row) => row.remoteFolder.trim().toLowerCase() === "other"),
    false,
  );
  assert.ok(plan.logs.every((line) => !/delete product/i.test(line)));
  const tree = [...plan.next.categories.map((row) => row.name), ...plan.next.subCategories.map((row) => row.name)].join("\n");
  assert.equal(/quantum|canboso|کوانتوم|کنبوسو|کانبوسو/i.test(tree), false);

  const again = planQuantumCategorySeed(plan.next);
  assert.equal(again.changes, 0);
  assert.equal(again.skipped, 0);

  assert.ok(SHOP_TAXONOMY.some((row) => row.name === AI_API_CATEGORY_NAME && row.brands.length === 0));
  assert.ok(SHOP_TAXONOMY.some((row) => row.name === SOCIAL_CATEGORY_NAME && row.brands.length === 0));
});
