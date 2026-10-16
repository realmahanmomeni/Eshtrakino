import test from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_COURSERA_LATIN,
  CORRUPTED_COURSERA_TOKEN,
  normalizeArabicToPersianCharsPreservingLatin,
  repairCourseraTokenInText,
} from "./latinText";
import { polishCustomerProductTitle } from "../services/catalog/productTitlePolish";

test("normalizeArabicToPersianCharsPreservingLatin keeps Coursera intact", () => {
  const input = "Coursera Plus ۱۲ ماهه";
  assert.equal(normalizeArabicToPersianCharsPreservingLatin(input), input);
});

test("repairCourseraTokenInText fixes corrupted token", () => {
  assert.equal(
    repairCourseraTokenInText(`کورسرا ${CORRUPTED_COURSERA_TOKEN} پرمیوم`),
    `کورسرا ${CANONICAL_COURSERA_LATIN} پرمیوم`,
  );
});

test("polishCustomerProductTitle preserves Coursera latin brand", () => {
  const out = polishCustomerProductTitle("Coursera Plus NW 12 month");
  assert.match(out, /Coursera/i);
  assert.ok(!out.includes(CORRUPTED_COURSERA_TOKEN));
});
