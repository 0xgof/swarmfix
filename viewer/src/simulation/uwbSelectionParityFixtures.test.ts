/**
 * Drift guard for the BLF-003 UWB selection parity fixtures.
 *
 * The committed JSON fixture file is the contract the Python selector port
 * is tested against. If the TypeScript selector's behavior changes, this
 * test fails, signaling that the Python port and fixtures must be updated
 * together. Regenerate with:
 *
 *   UPDATE_UWB_PARITY_FIXTURES=1 npm test -- --run src/simulation/uwbSelectionParityFixtures.test.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, it } from "vitest";

import { buildParityFixtures } from "./uwbSelectionParityFixtures";

const FIXTURE_PATH = resolve(
  process.cwd(),
  "..",
  "tests",
  "fixtures",
  "uwb_selection_parity.json"
);

it("committed parity fixtures match the current TypeScript selector output", () => {
  const fixtures = JSON.parse(JSON.stringify(buildParityFixtures()));

  if (process.env.UPDATE_UWB_PARITY_FIXTURES === "1") {
    mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
    writeFileSync(FIXTURE_PATH, `${JSON.stringify(fixtures, null, 2)}\n`);
  }

  const committed = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8"));
  expect(committed).toEqual(fixtures);
});

it("fixtures cover initial fill, retention, range drop, ring, collinear, and cap pressure", () => {
  const fixtures = buildParityFixtures();

  const names = fixtures.scenarios.map((scenario) => scenario.name);

  expect(names).toEqual([
    "grid9_initial_fill_cap3",
    "grid9_retention_budget2",
    "grid9_range_limited_drop",
    "ring8_initial_fill_cap2",
    "line5_collinear_angle_gate",
    "grid6_cap1_pressure"
  ]);
  const retention = fixtures.scenarios[1];
  expect(retention.previous_selected_links.length).toBeGreaterThan(0);
  const angleGate = fixtures.scenarios[4];
  expect(angleGate.expected.diagnostics.selected_link_count).toBeLessThan(
    angleGate.expected.diagnostics.candidate_link_count
  );
});
