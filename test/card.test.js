import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const window = new Window({ url: "http://localhost/" });
for (const key of ["window", "document", "HTMLElement", "customElements", "Event", "CustomEvent", "ResizeObserver"]) globalThis[key] = key === "window" ? window : window[key];
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const draws = [];
window.HTMLCanvasElement.prototype.getContext = function () {
  return { createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage(...args) { draws.push(args); }, imageSmoothingEnabled: false };
};
await import("../src/card.js");
afterEach(() => { document.body.replaceChildren(); draws.length = 0; });

function frame(value = 100) {
  const raw = new Uint8Array(128);
  for (let i = 0; i < 64; i++) { raw[2 * i] = value & 255; raw[2 * i + 1] = value >> 8; }
  return Buffer.from(raw).toString("base64");
}
function state(value, attributes = {}, ago = 0) { return { state: String(value), attributes, last_updated: new Date(Date.now() - ago).toISOString() }; }
function setup(extra = {}) {
  const card = document.createElement("thermal-monitor-card");
  const entities = { pixels: "sensor.pixels", people_count: "sensor.count", presence_ready: "binary_sensor.ready", auto_switch: "switch.auto", manual_offset: "number.trim", virtual_setpoint: "number.reference", learn_scene: "button.learn", ...extra };
  card.setConfig({ title: "Thermal Test", entities });
  const calls = [];
  const hass = { locale: { language: "it" }, states: { "sensor.pixels": state(frame()), "sensor.count": state(2), "binary_sensor.ready": state("on"), "switch.auto": state("on"), "number.trim": state(0, { min: -15, max: 15, step: 0.25 }), "number.reference": state(22, { min: 0, max: 50, step: 0.5 }), "button.learn": state("unknown") }, callService: async (...args) => { calls.push(args); } };
  card.hass = hass; document.body.appendChild(card);
  return { card, hass, calls, root: card.shadowRoot };
}

test("real custom element decodes and draws the frame; no reference or offset in monitor", async () => {
  const { card, root } = setup();
  card._draw();
  assert.equal(card._frame[0], 25); assert.ok(draws.length);
  assert.equal(root.querySelector('[data-text="count"]').textContent, "2 presenze stimate");
  assert.equal(root.querySelector("#details").hidden, true);
  assert.equal(root.querySelector("#monitor [data-entity=reference]"), null);
  assert.equal(root.querySelector("#monitor [data-entity=total_offset]"), null);
});
test("tabs switch panels and remain below their contents", () => {
  const { root } = setup();
  root.querySelector("#tab-details").click();
  assert.equal(root.querySelector("#monitor").hidden, true); assert.equal(root.querySelector("#details").hidden, false);
  assert.equal(root.querySelector("#tab-details").getAttribute("aria-selected"), "true");
  assert.equal(root.querySelector("ha-card").lastElementChild.className, "tabs");
  root.querySelector("#tab-config").click(); assert.equal(root.querySelector("#config").hidden, false);
});
test("unrelated HA changes neither decode nor redraw the frame", () => {
  const { card, hass } = setup(); let decoded = 0;
  const original = card._consumeFrame.bind(card); card._consumeFrame = () => { decoded++; original(); };
  card.hass = { ...hass, states: { ...hass.states, "sensor.unrelated": state(100) } };
  assert.equal(decoded, 0);
});
test("stale or malformed frames preserve image but invalidate occupancy", () => {
  const { card, hass, root } = setup();
  card.hass = { ...hass, states: { ...hass.states, "sensor.pixels": state(frame(), {}, 20000) } };
  assert.equal(card._fresh(), false); assert.equal(root.querySelector('[data-text="count"]').textContent, "Dato non disponibile");
  assert.equal(root.querySelector(".stale").hidden, false);
  card.hass = { ...hass, states: { ...hass.states, "sensor.pixels": state("not-base64") } };
  assert.equal(card._frame[0], 25); assert.match(root.querySelector('[data-text="frame-status"]').textContent, /non valida/);
  card.hass = hass; assert.equal(card._fresh(), true);
});
test("HA controls use only configured entity IDs and exact services", async () => {
  const { root, calls } = setup();
  const checkbox = root.querySelector("#auto"); checkbox.checked = false; checkbox.dispatchEvent(new Event("change"));
  await Promise.resolve();
  assert.deepEqual(calls[0], ["switch", "turn_off", { entity_id: "switch.auto" }]);
  const trim = root.querySelector("#manual"); trim.value = "1.25"; trim.dispatchEvent(new Event("change")); await Promise.resolve();
  assert.deepEqual(calls[1], ["number", "set_value", { value: 1.25, entity_id: "number.trim" }]);
  const reference = root.querySelector("#virtual"); reference.value = "23"; reference.dispatchEvent(new Event("change")); await Promise.resolve();
  assert.deepEqual(calls[2], ["number", "set_value", { value: 23, entity_id: "number.reference" }]);
  reference.value = "100"; reference.dispatchEvent(new Event("change")); assert.equal(calls.length, 3);
});
test("empty-scene learning requires confirmation, including first press in unknown state", async () => {
  const { root, calls } = setup(); const learn = root.querySelector("#learn");
  assert.equal(learn.disabled, false);
  window.confirm = () => false; learn.click(); assert.equal(calls.length, 0);
  window.confirm = () => true; learn.click(); await Promise.resolve();
  assert.deepEqual(calls[0], ["button", "press", { entity_id: "button.learn" }]);
});
test("service failures are visible and pending controls recover", async () => {
  const { card, hass, root } = setup();
  card.hass = { ...hass, callService: async () => { throw new Error("Disconnected"); } };
  await card._service("auto_switch", "switch", "turn_off");
  assert.match(root.querySelector(".error").textContent, /Disconnected/);
  assert.equal(root.querySelector("#auto").disabled, false);
});
test("title is text, settings persist through state updates, timers clean up", () => {
  const { card, hass, root } = setup();
  card.setConfig({ title: '<img src=x onerror="alert(1)">', entity: "sensor.pixels" });
  assert.equal(root.querySelector("header img"), null);
  root.querySelector("#tab-config").click(); card.hass = hass;
  assert.equal(root.querySelector("#config").hidden, false);
  assert.ok(card._timer); card.remove(); assert.equal(card._timer, null); assert.equal(card._raf, null);
});
