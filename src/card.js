import { VERSION, ENTITY_KEYS, normalizeConfig, decodeFrame, statistics, temperatureRange, frameColors, numericState, frameTimestamp, occupancyModel, compensationLabel, sampleRate } from "./core.js";

const STYLE = `
:host{display:block;color:var(--primary-text-color);font:14px/1.45 var(--paper-font-body1_-_font-family,system-ui,sans-serif)}
*{box-sizing:border-box}ha-card{display:block;overflow:hidden;background:var(--ha-card-background,var(--card-background-color));border:1px solid var(--ha-card-border-color,var(--divider-color));border-radius:var(--ha-card-border-radius,18px)}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 18px 12px}.title{font-size:19px;font-weight:500;letter-spacing:-.3px}.sub{color:var(--secondary-text-color);font-size:12px}.connection{display:flex;align-items:center;gap:6px;margin-top:3px}.dot{height:7px;width:7px;border-radius:50%;background:var(--success-color,#299c71)}.dot.off{background:var(--warning-color,#d59924)}
.panel[hidden], [hidden]{display:none!important}.camera{position:relative;aspect-ratio:1;margin:0 12px;border-radius:12px;overflow:hidden;background:#181331;color:#fff}canvas{display:block;width:100%;height:100%}.overlays{position:absolute;inset:10px 10px auto;display:flex;justify-content:space-between;gap:8px;pointer-events:none}.overlay{padding:5px 8px;border-radius:7px;background:#141820d9;color:#fff;font-size:12px}.stale{position:absolute;inset:0;display:grid;place-content:center;text-align:center;gap:8px;background:#161b24b3;color:#fff;padding:20px}.stale strong{font-size:17px;font-weight:500}.stale span{font-size:12px;color:#e0e6ed}
.scale{display:flex;align-items:center;gap:10px;margin:10px 14px 0;font-size:12px;color:var(--secondary-text-color)}.gradient{flex:1;height:5px;border-radius:5px;background:linear-gradient(90deg,#17105d,#3722a4,#226bcc,#1dcab2,#efd941,#ff7836,#e84637)}.summary{padding:16px 18px 18px}.count{font-size:25px;font-weight:500;letter-spacing:-.6px;font-variant-numeric:tabular-nums}.count small{font-size:13px;font-weight:400;letter-spacing:0}.meta{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--secondary-text-color);margin-top:4px}
.content{padding:2px 18px 18px}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:8px 0 14px}.metric{font-size:23px;font-weight:500;font-variant-numeric:tabular-nums}.row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:38px;padding:6px 0}.row>span:first-child{color:var(--secondary-text-color)}.row>span:last-child{text-align:right;font-variant-numeric:tabular-nums}.heading{color:var(--secondary-text-color);font-size:12px;margin:14px 0 5px}.note{font-size:12px;color:var(--secondary-text-color);margin:10px 0}.control{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0}.control label{flex:1}.control input[type=number]{width:106px;max-width:45%;padding:7px 9px;background:var(--secondary-background-color);color:var(--primary-text-color);border:1px solid var(--divider-color);border-radius:7px;font:inherit;font-variant-numeric:tabular-nums}.control input[type=checkbox]{width:19px;height:19px;accent-color:var(--primary-color);cursor:pointer}.control small{display:block;color:var(--secondary-text-color);font-size:12px}
button{font:inherit;color:var(--primary-text-color);cursor:pointer;border:1px solid var(--divider-color);background:var(--secondary-background-color);border-radius:8px;padding:8px 12px;min-height:36px}button:disabled,input:disabled{opacity:.5;cursor:not-allowed}button:focus-visible,input:focus-visible{outline:2px solid var(--primary-color);outline-offset:2px}.buttons{display:flex;gap:8px;flex-wrap:wrap}.buttons button[aria-pressed=true]{background:var(--primary-color);color:var(--text-primary-color,#fff);border-color:transparent}.error{padding:10px 18px;color:var(--error-color,#bf3030);font-size:13px;overflow-wrap:anywhere}.tabs{display:flex;gap:3px;margin:0 12px 12px;padding:3px;border-radius:8px;background:var(--secondary-background-color)}.tabs button{flex:1;min-width:0;padding:4px 6px;min-height:29px;border:0;border-radius:5px;background:transparent;font-size:12px;color:var(--secondary-text-color)}.tabs button[aria-selected=true]{background:var(--ha-card-background,var(--card-background-color));color:var(--primary-text-color);box-shadow:0 1px 3px #0002;font-weight:500}.version{text-align:right;font-size:11px;color:var(--secondary-text-color);margin-top:12px}
@media(pointer:coarse){.tabs button{min-height:44px}.control input[type=number]{font-size:16px}}
`;

export class ThermalMonitorCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "monitor";
    this._samples = [];
    this._pending = new Set();
    this._frame = null;
    this._sourceError = "In attesa del sensore";
    this._lastKey = null;
    this._lastFrameAt = null;
    this._actionError = "";
  }

  setConfig(config) {
    this._config = normalizeConfig(config);
    this._interpolate = this._config.interpolate;
    this._autoRange = this._config.autoRange;
    this._minimum = this._config.minimum;
    this._maximum = this._config.maximum;
    this._frame = null; this._lastKey = null; this._lastFrameAt = null; this._samples = []; this._lastStates = null;
    this._sourceError = "In attesa del sensore";
    this._build();
    this._update();
  }

  set hass(value) {
    this._hass = value;
    if (!this._config || !this._built) return;
    const ids = Object.values(this._config.entities);
    const language = value?.locale?.language ?? value?.language;
    if (this._lastStates && this._lastLanguage === language && ids.every(id => this._lastStates[id] === value?.states?.[id])) return;
    this._lastStates = Object.fromEntries(ids.map(id => [id, value?.states?.[id]]));
    this._lastLanguage = language;
    this._consumeFrame();
    this._render();
  }
  get hass() { return this._hass; }

  connectedCallback() {
    if (!this._timer) this._timer = setInterval(() => this._render(), 1000);
    if (typeof ResizeObserver !== "undefined" && !this._observer) {
      this._observer = new ResizeObserver(() => this._scheduleDraw());
      this._observer.observe(this);
    }
    this._update();
  }

  disconnectedCallback() {
    clearInterval(this._timer); this._timer = null;
    this._observer?.disconnect(); this._observer = null;
    if (this._raf != null) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  getGridOptions() { return { columns: 12, rows: "auto", min_columns: 6 }; }
  getCardSize() { return this._tab === "monitor" ? 10 : 7; }

  static getStubConfig(hass) {
    const states = hass?.states ?? {};
    const first = Object.keys(states).find(id => id.endsWith("_sensor_calibrated_pixels")) ?? Object.keys(states).find(id => id.endsWith("_sensor_raw_pixels"));
    return { type: "custom:thermal-monitor-card", entities: { pixels: first ?? "sensor.thermal_sensor_calibrated_pixels" } };
  }

  _build() {
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card>
      <header><div><div class="title"></div><div class="sub connection"><span class="dot"></span><span data-text="connection">In attesa</span><span>· AMG8833</span></div></div></header>
      <section class="panel" id="monitor" role="tabpanel" aria-labelledby="tab-monitor">
        <div class="camera"><canvas aria-label="Mappa termica AMG8833"></canvas><div class="overlays"><span class="overlay" data-text="rate">Misuro la frequenza…</span><span class="overlay" data-text="occupancy">Da inizializzare</span></div><div class="stale"><strong data-text="frame-status">In attesa del sensore</strong><span data-text="age">Nessun frame ricevuto</span></div></div>
        <div class="scale"><span data-text="scale-min">—</span><span class="gradient"></span><span data-text="scale-max">—</span></div>
        <div class="summary" aria-live="polite"><div class="count" data-text="count">—</div><div class="meta"><span data-text="model">Modello da inizializzare</span><span data-text="frame-age">Nessun frame</span></div></div>
      </section>
      <section class="panel" id="details" role="tabpanel" aria-labelledby="tab-details" hidden><div class="content">
        <div class="metrics"><div><div class="sub">Riferimento</div><div class="metric" data-entity="reference">—</div><div class="sub" data-text="reference-source">—</div></div><div><div class="sub">Offset totale</div><div class="metric" data-entity="total_offset">—</div><div class="sub">Applicato ai pixel corretti</div></div></div>
        <div class="row"><span>Stato compensazione</span><span data-text="compensation">—</span></div>
        <div class="row"><span>Offset automatico</span><span data-entity="automatic_offset">—</span></div><div class="row"><span>Correzione manuale</span><span data-entity="manual_offset">—</span></div><div class="row"><span>Fondo scena (mediana)</span><span data-entity="background">—</span></div>
        <div class="heading">Frame visualizzato · °C</div><div class="row"><span>Minima / media / massima</span><span data-text="frame-stats">—</span></div>
        <div class="heading">Misure originali</div><div class="row"><span>Minima grezza</span><span data-entity="raw_minimum">—</span></div><div class="row"><span>Media grezza</span><span data-entity="raw_average">—</span></div><div class="row"><span>Massima grezza</span><span data-entity="raw_maximum">—</span></div><div class="row"><span>Temperatura interna</span><span data-entity="chip_temperature">—</span></div>
        <div class="note">Il conteggio è una stima di zone calde. La compensazione normalizza lo sfondo: non è una calibrazione assoluta delle superfici.</div>
      </div></section>
      <section class="panel" id="config" role="tabpanel" aria-labelledby="tab-config" hidden><div class="content">
        <div class="control" data-control="auto_switch"><label for="auto">Compensazione automatica</label><input id="auto" type="checkbox" role="switch"></div>
        <div class="control" data-control="manual_offset"><label for="manual">Correzione manuale<small>Aggiunta all’offset automatico</small></label><input id="manual" type="number" step="0.25" aria-label="Correzione manuale"></div>
        <div class="control" data-control="virtual_setpoint"><label for="virtual">Temperatura virtuale<small>Solo simulazione · non è una misura reale</small></label><input id="virtual" type="number" step="0.5" aria-label="Temperatura virtuale"></div>
        <div class="heading">Visualizzazione</div><div class="buttons"><button type="button" data-view="smooth" aria-pressed="true">Interpolata</button><button type="button" data-view="pixel" aria-pressed="false">8 × 8</button></div>
        <div class="control"><label for="range-auto">Scala temperatura automatica</label><input id="range-auto" type="checkbox"></div>
        <div class="control" data-manual-scale><label for="scale-min">Minima scala (°C)</label><input id="scale-min" type="number" step="0.5"></div><div class="control" data-manual-scale><label for="scale-max">Massima scala (°C)</label><input id="scale-max" type="number" step="0.5"></div>
        <div data-control="learn_scene"><div class="heading">Modello di presenza</div><button type="button" id="learn">Apprendi scena vuota</button><div class="note">Premi solo quando non c’è nessuno nell’inquadratura. Ripeti dopo aver riavviato o spostato il Wemos.</div></div>
        <div class="version">Thermal Monitor Card ${VERSION}</div>
      </div></section>
      <div class="error" role="alert" hidden></div>
      <nav class="tabs" role="tablist" aria-label="Sezioni Thermal Monitor"><button type="button" id="tab-monitor" role="tab" aria-controls="monitor" aria-selected="true" data-tab="monitor">Monitor</button><button type="button" id="tab-details" role="tab" aria-controls="details" aria-selected="false" data-tab="details">Dettagli</button><button type="button" id="tab-config" role="tab" aria-controls="config" aria-selected="false" data-tab="config">Configurazione</button></nav>
    </ha-card>`;
    this.shadowRoot.querySelector(".title").textContent = this._config.title;
    this._canvas = this.shadowRoot.querySelector("canvas");
    this._smallCanvas = document.createElement("canvas"); this._smallCanvas.width = this._smallCanvas.height = 8;
    this._built = true;
    this.shadowRoot.querySelectorAll("[data-tab]").forEach(button => {
      button.addEventListener("click", () => this._selectTab(button.dataset.tab));
      button.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = ["monitor", "details", "config"];
        let i = tabs.indexOf(this._tab);
        i = event.key === "Home" ? 0 : event.key === "End" ? 2 : (i + (event.key === "ArrowRight" ? 1 : 2)) % 3;
        event.preventDefault(); this._selectTab(tabs[i]); this.shadowRoot.querySelector(`#tab-${tabs[i]}`).focus();
      });
    });
    this.shadowRoot.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => { this._interpolate = button.dataset.view === "smooth"; this._render(); this._scheduleDraw(); }));
    this.shadowRoot.querySelector("#range-auto").addEventListener("change", event => { this._autoRange = event.target.checked; this._render(); this._scheduleDraw(); });
    for (const [id, key] of [["manual", "manual_offset"], ["virtual", "virtual_setpoint"]]) {
      this.shadowRoot.querySelector(`#${id}`).addEventListener("change", event => {
        const value = Number(event.target.value);
        const state = this._state(key), minimum = Number(state?.attributes?.min ?? -Infinity), maximum = Number(state?.attributes?.max ?? Infinity);
        if (event.target.value.trim() === "" || !Number.isFinite(value) || value < minimum || value > maximum) { this._actionError = "Valore fuori intervallo"; this._render(); return; }
        this._service(key, "number", "set_value", { value });
      });
    }
    this.shadowRoot.querySelector("#auto").addEventListener("change", event => this._service("auto_switch", "switch", event.target.checked ? "turn_on" : "turn_off"));
    this.shadowRoot.querySelector("#learn").addEventListener("click", () => {
      if (window.confirm("Apprendere la scena attuale? Nessuno deve essere nell’inquadratura.")) this._service("learn_scene", "button", "press");
    });
    for (const id of ["scale-min", "scale-max"]) this.shadowRoot.querySelector(`#${id}`).addEventListener("change", () => {
      const lo = Number(this.shadowRoot.querySelector("#scale-min").value), hi = Number(this.shadowRoot.querySelector("#scale-max").value);
      if (Number.isFinite(lo) && Number.isFinite(hi) && lo < hi) { this._minimum = lo; this._maximum = hi; this._actionError = ""; this._scheduleDraw(); }
      else this._actionError = "La minima scala deve essere inferiore alla massima";
      this._render();
    });
  }

  _state(key) { return this._hass?.states?.[this._config?.entities?.[key]]; }
  _text(key, text) { this.shadowRoot.querySelectorAll(`[data-text="${key}"]`).forEach(node => { if (node.textContent !== text) node.textContent = text; }); }
  _number(value, decimals = 1) { return new Intl.NumberFormat(this._hass?.locale?.language ?? this._hass?.language ?? "it", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value); }
  _format(state) {
    if (!state || ["unknown", "unavailable"].includes(state.state)) return "—";
    if (typeof this._hass?.formatEntityState === "function") return this._hass.formatEntityState(state);
    const numeric = numericState(state), unit = state.attributes?.unit_of_measurement;
    return `${numeric === null ? state.state : this._number(numeric, 2)}${unit ? ` ${unit}` : ""}`;
  }

  _update() { if (this._config && this._built) { this._consumeFrame(); this._render(); this._scheduleDraw(); } }
  _consumeFrame() {
    const state = this._state("pixels");
    if (!state || ["unknown", "unavailable"].includes(state.state)) { this._sourceError = !state ? "Sensore pixel non trovato" : "Sensore pixel non disponibile"; return; }
    const key = `${state.last_updated ?? ""}|${state.state}`;
    if (key === this._lastKey && !this._sourceError) return;
    this._lastKey = key;
    try {
      this._frame = decodeFrame(state.state); this._stats = statistics(this._frame);
      const now = Date.now(), timestamp = frameTimestamp(state, now);
      this._lastFrameAt = timestamp; this._sourceError = "";
      if (!this._samples.length || timestamp > this._samples.at(-1)) this._samples.push(timestamp);
      this._samples = this._samples.filter(time => time >= now - 10000).slice(-200);
      this._scheduleDraw();
    } catch (error) { this._sourceError = error.message; }
  }

  _fresh() { return Boolean(this._frame && !this._sourceError && this._lastFrameAt !== null && Date.now() - this._lastFrameAt <= this._config.staleAfter * 1000); }

  _render() {
    if (!this._built || !this._config) return;
    const fresh = this._fresh(), now = Date.now();
    const age = this._lastFrameAt === null ? null : Math.max(0, (now - this._lastFrameAt) / 1000);
    const ageText = age === null ? "Nessun frame ricevuto" : age < 1 ? "Ultimo frame · ora" : `Ultimo frame · ${Math.floor(age)} s fa`;
    const occupancy = occupancyModel(this._hass?.states ?? {}, this._config.entities, fresh);
    this._text("connection", fresh ? "Dati aggiornati" : this._frame ? "Dati non aggiornati" : "In attesa");
    this.shadowRoot.querySelector(".dot").classList.toggle("off", !fresh);
    this._text("occupancy", occupancy.label);
    this._text("count", occupancy.count !== null ? `${occupancy.count} ${occupancy.count === 1 ? "presenza stimata" : "presenze stimate"}` : occupancy.label);
    this._text("model", !this._config.entities.presence_ready ? "Modello non configurato" : occupancy.ready ? "Scena appresa · conteggio stimato" : "Modello da inizializzare");
    this._text("age", ageText); this._text("frame-age", ageText);
    this.shadowRoot.querySelector(".stale").hidden = fresh;
    this._text("frame-status", this._sourceError || "Dati non aggiornati");
    const rate = sampleRate(this._samples, now);
    this._text("rate", fresh && rate !== null ? `${this._number(rate)} frame/s ricevuti` : fresh ? "Misuro la frequenza…" : "Nessun nuovo frame");
    this.shadowRoot.querySelectorAll("[data-entity]").forEach(node => { node.textContent = this._format(this._state(node.dataset.entity)); });
    const source = this._state("reference_source")?.state;
    this._text("reference-source", ({ "Home Assistant": "Home Assistant", "Local sensor": "Sensore locale", "Unavailable": "Nessun riferimento" })[source] ?? "—");
    this._text("compensation", compensationLabel(this._state("compensation_status")?.state ?? "—"));
    this._text("frame-stats", fresh && this._stats ? `${this._number(this._stats.minimum)} / ${this._number(this._stats.average)} / ${this._number(this._stats.maximum)}` : "—");
    for (const key of ["auto_switch", "manual_offset", "virtual_setpoint", "learn_scene"]) {
      const row = this.shadowRoot.querySelector(`[data-control="${key}"]`); row.hidden = !this._config.entities[key];
      const input = row.querySelector("input,button"), state = this._state(key);
      const available = Boolean(state && !["unknown", "unavailable"].includes(state.state));
      // Button entities often have an unknown state before their first press.
      input.disabled = this._pending.has(key) || !(key === "learn_scene" ? state && state.state !== "unavailable" : available);
      if (key === "auto_switch") input.checked = state?.state === "on";
      else if (key !== "learn_scene") {
        const value = numericState(state);
        if (this.shadowRoot.activeElement !== input) input.value = value === null ? "" : String(value);
        for (const attr of ["min", "max", "step"]) if (Number.isFinite(Number(state?.attributes?.[attr]))) input.setAttribute(attr, state.attributes[attr]);
      }
    }
    this.shadowRoot.querySelectorAll("[data-tab]").forEach(button => button.setAttribute("aria-selected", String(button.dataset.tab === this._tab)));
    this.shadowRoot.querySelectorAll(".panel").forEach(panel => { panel.hidden = panel.id !== this._tab; });
    this.shadowRoot.querySelectorAll("[data-view]").forEach(button => button.setAttribute("aria-pressed", String((button.dataset.view === "smooth") === this._interpolate)));
    this.shadowRoot.querySelector("#range-auto").checked = this._autoRange;
    this.shadowRoot.querySelectorAll("[data-manual-scale]").forEach(row => { row.hidden = this._autoRange; });
    for (const [id, value] of [["scale-min", this._minimum], ["scale-max", this._maximum]]) {
      const input = this.shadowRoot.querySelector(`#${id}`); if (this.shadowRoot.activeElement !== input) input.value = value;
    }
    const error = this.shadowRoot.querySelector(".error"); error.textContent = this._actionError; error.hidden = !this._actionError;
  }

  _selectTab(tab) { this._tab = tab; this._render(); if (tab === "monitor") this._scheduleDraw(); this.dispatchEvent(new Event("iron-resize", { bubbles: true, composed: true })); }

  async _service(key, domain, service, data = {}) {
    const entity = this._config.entities[key];
    if (!entity || !this._hass?.callService || this._pending.has(key)) return;
    this._pending.add(key); this._actionError = ""; this._render();
    try { await this._hass.callService(domain, service, { ...data, entity_id: entity }); }
    catch (error) { this._actionError = `Comando non riuscito: ${error?.message ?? String(error)}`; }
    finally { this._pending.delete(key); this._render(); }
  }

  _scheduleDraw() {
    if (!this.isConnected || this._tab !== "monitor" || this._raf != null) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this._draw(); });
  }

  _draw() {
    if (!this._frame || !this._canvas || this._tab !== "monitor") return;
    const context = this._canvas.getContext("2d"), small = this._smallCanvas.getContext("2d");
    if (!context || !small) { this._sourceError = "Canvas non supportato dal browser"; this._render(); return; }
    const [minimum, maximum] = temperatureRange(this._stats, this._autoRange, this._minimum, this._maximum);
    const image = small.createImageData(8, 8); image.data.set(frameColors(this._frame, minimum, maximum)); small.putImageData(image, 0, 0);
    const width = Math.min(1200, Math.max(8, Math.round((this._canvas.getBoundingClientRect().width || 320) * Math.min(2, window.devicePixelRatio || 1))));
    if (this._canvas.width !== width || this._canvas.height !== width) { this._canvas.width = this._canvas.height = width; }
    context.imageSmoothingEnabled = this._interpolate; context.imageSmoothingQuality = "high"; context.drawImage(this._smallCanvas, 0, 0, width, width);
    this._text("scale-min", `${this._number(minimum)} °C`); this._text("scale-max", `${this._number(maximum)} °C`);
    this._canvas.setAttribute("aria-label", `Mappa termica 8 per 8: minima ${this._number(this._stats.minimum)}, massima ${this._number(this._stats.maximum)} gradi Celsius`);
  }
}

if (!customElements.get("thermal-monitor-card")) customElements.define("thermal-monitor-card", ThermalMonitorCard);
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "thermal-monitor-card")) window.customCards.push({ type: "thermal-monitor-card", name: "Thermal Monitor", description: "Camera termica, occupazione e compensazione con schede compatte in basso", preview: true });
