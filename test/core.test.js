import test from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, decodeFrame, statistics, temperatureRange, frameColors, occupancyModel, sampleRate } from "../src/core.js";

const encode = bytes => Buffer.from(bytes).toString("base64");
test("decodes real AMG8833 signed-magnitude little-endian frame format", () => {
  const bytes = new Uint8Array(128);
  const words = [0, 1, 0x804, 0x100, 0x500, 0x7ff, 0xfff, 0x800];
  for (let i = 0; i < 64; i++) { const value = words[i] ?? 100; bytes[i * 2] = value & 255; bytes[i * 2 + 1] = value >> 8; }
  const values = decodeFrame(encode(bytes));
  assert.deepEqual([...values.slice(0, 7)], [0, 0.25, -1, 64, 320, 511.75, -511.75]);
  assert.equal(values.length, 64);
  assert.equal(values[63], 25);
});
test("legacy frames preserve 0 and 63.75 C without signed-byte conversion", () => {
  const bytes = new Uint8Array(64).fill(255); bytes[0] = 0;
  const frame = decodeFrame(encode(bytes)); assert.equal(frame[0], 0); assert.equal(frame[63], 63.75);
});
test("rejects malformed, truncated, unknown and oversized data", () => {
  for (const input of ["", "unknown", "unavailable", "@bad!", encode(new Uint8Array(63)), encode(new Uint8Array(127)), "A".repeat(10000), null]) assert.throws(() => decodeFrame(input));
});
test("statistics and automatic scale work for uniform and negative frames", () => {
  const frame = new Float32Array(64).fill(-2);
  assert.deepEqual(statistics(frame), { minimum: -2, maximum: -2, average: -2 });
  assert.deepEqual(temperatureRange(statistics(frame), true, 18, 34), [-4, 0]);
  assert.deepEqual(temperatureRange(statistics(frame), false, 18, 34), [18, 34]);
  assert.throws(() => statistics([NaN]));
});
test("palette clips endpoints, produces 64 opaque pixels and rejects empty scale", () => {
  const frame = new Float32Array(64).fill(10); frame[63] = 100;
  const rgba = frameColors(frame, 18, 34);
  assert.equal(rgba.length, 256); assert.deepEqual([...rgba.slice(0, 4)], [23, 16, 93, 255]);
  assert.deepEqual([...rgba.slice(-4)], [232, 70, 55, 255]); assert.throws(() => frameColors(frame, 20, 20));
});
test("unknown model and stale frames never become zero people", () => {
  const entities = { people_count: "sensor.count", presence_ready: "binary_sensor.ready", occupancy: "binary_sensor.occupied" };
  const states = { "sensor.count": { state: "2" }, "binary_sensor.ready": { state: "on" }, "binary_sensor.occupied": { state: "on" } };
  assert.equal(occupancyModel(states, entities, true).count, 2);
  assert.equal(occupancyModel(states, entities, false).count, null);
  states["binary_sensor.ready"].state = "off";
  assert.equal(occupancyModel(states, entities, true).label, "Da inizializzare");
  states["binary_sensor.ready"].state = "on"; states["sensor.count"].state = "0";
  assert.equal(occupancyModel(states, entities, true).label, "Libero");
});
test("sample rate uses actual recent source timestamps", () => {
  assert.equal(sampleRate([1000], 1000), null);
  assert.equal(sampleRate([1000, 2000, 3000], 3000), 1);
  assert.equal(sampleRate([0, 20000, 20200, 20400], 20400), 5);
  assert.equal(sampleRate([1000, 1000], 1000), null);
});
test("validates entity targets and temperature scale before rendering", () => {
  assert.throws(() => normalizeConfig({}));
  assert.throws(() => normalizeConfig({ entity: "sensor.pixels", entities: { auto_switch: "light.room" } }));
  assert.throws(() => normalizeConfig({ entity: "sensor.pixels", minimum_temperature: 30, maximum_temperature: 10 }));
  assert.throws(() => normalizeConfig({ entity: "sensor.pixels", stale_after: 0 }));
  assert.equal(normalizeConfig({ entity: "sensor.pixels" }).staleAfter, 8);
});
