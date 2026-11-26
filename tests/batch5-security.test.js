import test from "node:test";
import assert from "node:assert/strict";
import { csvCell } from "../src/export.js";

test("batch5 csv formula hardening", () => {
  const csv = csvCell;

const payloads = ["\u200b=cmd", "\u061c+cmd", " \u200b@cmd", "\ufeff=cmd"];
for (const payload of payloads) {
  const cell = csv(payload);
  assert.ok(cell.startsWith("'") || cell.startsWith("\"'"), payload + " stayed live");
}
assert.equal(csv(-12.5), "-12.5");
assert.equal(csv("plain"), "plain");
});
