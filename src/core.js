export const VERSION = "0.1.0";
export const ENTITY_KEYS = ["pixels", "occupancy", "people_count", "presence_ready", "reference", "reference_source", "automatic_offset", "manual_offset", "total_offset", "background", "compensation_status", "auto_switch", "virtual_setpoint", "learn_scene", "chip_temperature", "raw_minimum", "raw_maximum", "raw_average"];

export function normalizeConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Configurazione Thermal Monitor mancante");
  const entities = { ...config.entities };
  if (config.entity && !entities.pixels) entities.pixels = config.entity;
  for (const [key, value] of Object.entries(entities)) {
    if (!ENTITY_KEYS.includes(key)) throw new Error(`Entità sconosciuta: ${key}`);
    if (typeof value !== "string" || !/^[a-z_]+\.[a-z0-9_]+$/.test(value)) throw new Error(`ID entità non valido: ${key}`);
  }
  if (!entities.pixels?.startsWith("sensor.")) throw new Error("Configura entities.pixels con il sensore dei pixel");
  for (const key of ["manual_offset", "virtual_setpoint"]) {
    if (entities[key] && !entities[key].startsWith("number.")) throw new Error(`${key} deve essere un'entità number`);
  }
  if (entities.auto_switch && !entities.auto_switch.startsWith("switch.")) throw new Error("auto_switch deve essere un'entità switch");
  if (entities.learn_scene && !entities.learn_scene.startsWith("button.")) throw new Error("learn_scene deve essere un'entità button");
  const staleAfter = config.stale_after ?? 8;
  if (!Number.isFinite(staleAfter) || staleAfter < 2 || staleAfter > 300) throw new Error("stale_after deve essere tra 2 e 300 secondi");
  const minimum = config.minimum_temperature ?? 18;
  const maximum = config.maximum_temperature ?? 34;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum >= maximum) throw new Error("Scala temperatura non valida");
  return { title: String(config.title ?? "Thermal Monitor"), entities, staleAfter, minimum, maximum, interpolate: config.interpolate !== false, autoRange: config.auto_range !== false };
}

export function decodeFrame(encoded) {
  if (typeof encoded !== "string" || encoded.length > 200 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("Codifica frame non valida");
  const raw = atob(encoded);
  if (raw.length !== 64 && raw.length !== 128) throw new Error(`Frame di ${raw.length} byte: attesi 64 o 128`);
  const values = new Float32Array(64);
  for (let i = 0; i < 64; i++) {
    if (raw.length === 64) values[i] = raw.charCodeAt(i) * 0.25;
    else {
      const word = raw.charCodeAt(i * 2) | (raw.charCodeAt(i * 2 + 1) << 8);
      values[i] = (word & 0x800 ? -1 : 1) * (word & 0x7ff) * 0.25;
    }
  }
  return values;
}

export function statistics(values) {
  let minimum = Infinity, maximum = -Infinity, total = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error("Pixel non numerico");
    minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); total += value;
  }
  if (values.length !== 64) throw new Error("Sono richiesti 64 pixel");
  return { minimum, maximum, average: total / 64 };
}

export function temperatureRange(stats, auto, minimum, maximum) {
  if (!auto) return [minimum, maximum];
  const middle = (stats.minimum + stats.maximum) / 2;
  const span = Math.max(4, stats.maximum - stats.minimum);
  return [middle - span / 2, middle + span / 2];
}

const PALETTE = [[23, 16, 93], [55, 34, 164], [34, 107, 204], [29, 202, 178], [239, 217, 65], [255, 120, 54], [232, 70, 55]];
export function frameColors(values, minimum, maximum) {
  if (!(maximum > minimum)) throw new Error("Scala non valida");
  const rgba = new Uint8ClampedArray(256);
  for (let i = 0; i < 64; i++) {
    const point = Math.max(0, Math.min(PALETTE.length - 1, (values[i] - minimum) / (maximum - minimum) * (PALETTE.length - 1)));
    const lo = Math.min(PALETTE.length - 2, Math.floor(point)), fraction = point - lo;
    for (let color = 0; color < 3; color++) rgba[4 * i + color] = PALETTE[lo][color] + (PALETTE[lo + 1][color] - PALETTE[lo][color]) * fraction;
    rgba[4 * i + 3] = 255;
  }
  return rgba;
}

export function numericState(state) {
  if (!state || ["", "unknown", "unavailable"].includes(state.state)) return null;
  const value = Number(state.state);
  return Number.isFinite(value) ? value : null;
}

export function frameTimestamp(state, now) {
  const timestamp = Date.parse(state?.last_updated ?? "");
  return Number.isFinite(timestamp) && timestamp <= now + 5000 ? timestamp : now;
}

export function occupancyModel(states, entities, fresh) {
  if (!fresh) return { label: "Dato non disponibile", count: null, ready: false, occupied: false };
  const ready = entities.presence_ready ? states[entities.presence_ready]?.state === "on" : true;
  if (!ready) return { label: "Da inizializzare", count: null, ready: false, occupied: false };
  const count = numericState(states[entities.people_count]);
  const binary = states[entities.occupancy]?.state;
  if (count !== null && count >= 0) {
    const integer = Math.floor(count);
    return { label: integer > 0 ? "Occupato" : "Libero", count: integer, ready: true, occupied: integer > 0 };
  }
  if (binary === "on" || binary === "off") return { label: binary === "on" ? "Presenza rilevata" : "Libero", count: null, ready: true, occupied: binary === "on" };
  return { label: "Dato non disponibile", count: null, ready, occupied: false };
}

export function compensationLabel(value) {
  return ({ "Disabled": "Disattivata", "Frame unavailable (holding)": "Frame assente · offset mantenuto", "Reference unavailable (holding)": "Riferimento assente · offset mantenuto", "Presence detected (holding)": "Presenza · offset mantenuto", "Tracking": "Compensazione attiva", "Tracking (presence uninitialized)": "Attiva · presenza da inizializzare", "Offset limited": "Offset al limite" })[value] ?? value;
}

export function sampleRate(timestamps, now) {
  const recent = timestamps.filter(time => time >= now - 10000);
  if (recent.length < 2) return null;
  const duration = recent.at(-1) - recent[0];
  return duration > 0 ? (recent.length - 1) * 1000 / duration : null;
}
