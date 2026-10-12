// assets/js/tool.js — the free tool's front end.
//
// The browser holds no key and talks only to our own /api. The photo never leaves as a file upload: it is
// read into a data URL, posted, and the server drops it after the render. That is the privacy promise on
// the page, so keep it true here.
//
// Three things this file is careful about:
//   1. the gate. The first plan is free; the second asks for an email, which buys five a week. The server
//      decides — this only renders what it's told, so the client can never grant itself renders.
//   2. the drawing gets a visible "concept sketch · AI generated" label burned into the pixels before it
//      can be downloaded, so the label travels with a screenshot.
//   3. the dates become something you can put in a calendar, not just read.

const $ = (s) => document.querySelector(s);

const API_BASE = (window.PA_CONFIG && window.PA_CONFIG.apiBase) || "";
const apiUrl = (path) => `${API_BASE}${path}`;
const api = (path, opts) => fetch(apiUrl(path), opts);

const els = {
  form: $("#tool-form"),
  file: $("#file"),
  drop: $("#drop"),
  thumbs: $("#thumbs"),
  zip: $("#zip"),
  existing: $("#existing"),
  bedsType: $("#beds-type"),
  bedsCount: $("#beds-count"),
  sun: $("#sun"),
  email: $("#email"),
  go: $("#go"),
  allowance: $("#allowance"),
  status: $("#status"),
  queue: $("#queue"), qpos: $("#qpos"), qmsg: $("#qmsg"), qbar: $("#qbar"), qrow: $("#qrow"),
  gate: $("#gate"), gateEmail: $("#gate-email"), gateBtn: $("#gate-btn"), gateStatus: $("#gate-status"),
  result: $("#result")
};

const MAX_PHOTOS = 3;
let photos = [];
let pollTimer = null;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso) {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function say(msg, isError = false) {
  if (!els.status) return;
  els.status.textContent = msg || "";
  els.status.classList.toggle("err", !!isError);
}

function setQueue({ position, eta, message, closed }) {
  if (!els.queue) return;
  els.queue.classList.remove("hidden");
  els.queue.classList.toggle("closed", !!closed);
  if (message) els.qmsg.textContent = message;
  if (typeof position === "number" && position > 0) {
    els.qpos.textContent = `You're #${position} in line`;
    els.qrow.textContent = eta ? `about ${Math.max(1, Math.round(eta / 60))} min` : "estimating…";
    els.qbar.style.width = position === 1 ? "85%" : "25%";
  } else {
    els.qpos.textContent = "Working…";
    els.qbar.style.width = "95%";
  }
}

function showAllowance(status) {
  if (!els.allowance || !status) return;
  if (status.free_left > 0) {
    els.allowance.textContent = `Your free plan — the first one's on us.`;
  } else if (status.week_left > 0) {
    els.allowance.textContent = `${status.week_left} of ${status.renders_after_email} plans left this week.`;
  } else if (status.needs_email) {
    els.allowance.textContent = `That was your free plan — pop your email in and you get five a week.`;
  } else {
    els.allowance.textContent = `You've used this week's plans (${status.renders_after_email}). They come back in ${status.week_resets_in_days} day${status.week_resets_in_days === 1 ? "" : "s"}.`;
  }
}

/* ------------------------------------------------------------------ the drawing, labelled */

/** Draw the render onto a canvas with the AI/concept label burned in, so it survives a screenshot. */
function labelledImage(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const pad = Math.max(14, Math.round(img.width * 0.018));
      const strip = Math.max(46, Math.round(img.width * 0.055));
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height + strip;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0);
      x.fillStyle = "#fffdf6";
      x.fillRect(0, img.height, c.width, strip);
      x.fillStyle = "#20301c";
      x.strokeStyle = "#20301c";
      x.lineWidth = Math.max(2, Math.round(img.width * 0.002));
      x.strokeRect(x.lineWidth / 2, img.height + x.lineWidth / 2, c.width - x.lineWidth, strip - x.lineWidth);
      x.font = `bold ${Math.round(strip * 0.34)}px -apple-system, Helvetica, Arial, sans-serif`;
      x.fillStyle = "#20301c";
      x.fillText("Concept sketch — AI generated", pad, img.height + strip * 0.42);
      x.font = `${Math.round(strip * 0.26)}px -apple-system, Helvetica, Arial, sans-serif`;
      x.fillStyle = "#5b6a53";
      x.fillText("Not to scale. Not construction drawings. Confirm your own frost dates.", pad, img.height + strip * 0.78);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/* --------------------------------------------------- drawing 1: the illustration over the photo */

const overlayState = { photo: null, sketch: null, cache: {} };

/** The visitor's first photo is already in memory as a data URL; the demo falls back to the sample. */
function photoForOverlay() {
  if (photos && photos.length) return photos[0];
  return document.body.dataset.demoPhoto || null;
}

function loadImg(src) {
  if (overlayState.cache[src]) return overlayState.cache[src];
  const p = new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
  overlayState.cache[src] = p;
  return p;
}

async function paintOverlay() {
  const c = $("#overlay-canvas");
  if (!c || !overlayState.sketch) return;
  const mixEl = $("#overlay-mix");
  const mix = mixEl ? Number(mixEl.value) / 100 : 0.6;
  try {
    const sketch = await loadImg(overlayState.sketch);
    const w = sketch.naturalWidth || 1200;
    const h = sketch.naturalHeight || 900;
    c.width = w;
    c.height = h;
    const x = c.getContext("2d");
    x.fillStyle = "#fffdf6";
    x.fillRect(0, 0, w, h);
    if (overlayState.photo) {
      const photo = await loadImg(overlayState.photo);
      // cover-fit: the photo fills the frame, then the drawing sits over it
      const s = Math.max(w / photo.naturalWidth, h / photo.naturalHeight);
      const pw = photo.naturalWidth * s;
      const ph = photo.naturalHeight * s;
      x.drawImage(photo, (w - pw) / 2, (h - ph) / 2, pw, ph);
    }
    x.globalAlpha = mix;
    x.drawImage(sketch, 0, 0, w, h);
    x.globalAlpha = 1;
  } catch {
    // if the photo won't decode, show the illustration alone rather than nothing
    const sketch = await loadImg(overlayState.sketch).catch(() => null);
    if (sketch) { c.width = sketch.naturalWidth; c.height = sketch.naturalHeight; c.getContext("2d").drawImage(sketch, 0, 0); }
  }
}

/** Rasterise our own SVG plan so it can be printed or sent to a phone. */
function svgToPng(svg, scale = 2) {
  return new Promise((resolve) => {
    const w = Number((svg.match(/width="(\d+)"/) || [])[1] || 900);
    const h = Number((svg.match(/height="(\d+)"/) || [])[1] || 600);
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = w * scale;
      c.height = h * scale;
      const x = c.getContext("2d");
      x.fillStyle = "#fffdf6";
      x.fillRect(0, 0, c.width, c.height);
      x.scale(scale, scale);
      x.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function download(name, dataUrl) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** The harvest window as a calendar file — the point of knowing the dates at all. */
function icsFor(windows, place) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const pad = (n) => String(n).padStart(2, "0");
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Permaculture AI//planting plan//EN", "CALSCALE:GREGORIAN"
  ];
  windows.filter((w) => w.known).forEach((w) => {
    const d = w.window_open.replace(/-/g, "");
    const end = w.window_close.replace(/-/g, "");
    lines.push(
      "BEGIN:VEVENT",
      `UID:pa-${w.crop}-${d}@permacultureai.com`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`,
      `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${w.name} starts coming in`,
      `DESCRIPTION:From your Permaculture AI plan${place ? ` for ${place}` : ""}. Estimated window ${w.window_open} to ${w.window_close}. Concept sketch — confirm your own frost dates.`,
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return "data:text/calendar;charset=utf-8," + encodeURIComponent(lines.join("\r\n") + "\r\n");
}

/* ------------------------------------------------------------------ rendering the result */

function renderResult(j) {
  if (els.queue) els.queue.classList.add("hidden");
  if (els.gate) els.gate.classList.add("hidden");
  if (!els.result) return;
  els.result.classList.remove("hidden");

  const place = j.frost && j.frost.known ? j.frost.place : null;
  const title = $("#result-title");
  if (title) title.textContent = place ? `Your patch — ${place}` : "Your patch";

  // frost context: this is what the zip code bought
  const frostLine = $("#result-frost");
  if (frostLine) {
    frostLine.innerHTML = j.frost && j.frost.known
      ? `Last frost around <b>${j.frost.last_spring_freeze}</b>, first fall freeze around
         <b>${j.frost.first_fall_freeze}</b> — about <b>${j.frost.frost_free_days}</b> frost-free days
         ${j.frost.zone ? `(zone ${j.frost.zone})` : ""}.
         <span class="muted">${j.frost.caveat || ""}</span>`
      : `<span class="muted">No frost record for that zip — the dates below are general, not local.</span>`;
    frostLine.classList.remove("hidden");
  }

  // The layout drawing. We generate this ourselves and inline it, so there is nothing to be wrong about:
  // bed widths, paths, what goes where, to scale.
  const diagram = $("#result-diagram");
  if (diagram && j.diagram_svg) {
    diagram.innerHTML = j.diagram_svg;
    const svgEl = diagram.querySelector("svg");
    if (svgEl) {
      svgEl.removeAttribute("width");
      svgEl.removeAttribute("height");
      svgEl.style.width = "100%";
      svgEl.style.height = "auto";
    }
    const cap = $("#result-diagram-caption");
    if (cap) {
      const beds = (j.layout && j.layout.beds) || [];
      cap.textContent = beds.length + " bed" + (beds.length === 1 ? "" : "s")
        + ", drawn to scale — the bed-by-bed detail is in the plan below.";
    }
    const pngBtn = $("#download-plan-png");
    if (pngBtn) {
      pngBtn.classList.remove("hidden");
      pngBtn.onclick = (e) => {
        e.preventDefault();
        svgToPng(j.diagram_svg).then((url) => download("garden-plan.png", url));
      };
    }
    const svgBtn = $("#download-plan-svg");
    if (svgBtn) {
      svgBtn.classList.remove("hidden");
      svgBtn.onclick = (e) => {
        e.preventDefault();
        download("garden-plan.svg", "data:image/svg+xml;charset=utf-8," + encodeURIComponent(j.diagram_svg));
      };
    }
  }

  // Drawing 1: the illustration, laid OVER the visitor's own photo, with a slider. Two reasons to
  // composite rather than show the illustration alone: it answers "is this even my yard?", and it is
  // honest — the photo underneath is visibly the real thing, the drawing on top is visibly a redraw.
  const overlay = $("#overlay-canvas");
  if (overlay && j.plan_image_data_url) {
    overlayState.sketch = j.plan_image_data_url;
    overlayState.photo = overlayState.photo || photoForOverlay();
    paintOverlay();
    const mix = $("#overlay-mix");
    if (mix) mix.oninput = () => paintOverlay();
    const dl = $("#download-sketch");
    if (dl) {
      dl.onclick = (e) => {
        e.preventDefault();
        const url = overlay.toDataURL("image/png");
        if (url) download("your-yard-illustrated.png", url);
      };
    }
  }

  const beds = $("#result-beds");
  if (beds && j.bed_plan && j.bed_plan.length) {
    beds.innerHTML = `<h4>bed by bed${j.geometry_label ? ` — ${j.geometry_label}` : ""}</h4>`
      + j.bed_plan.map((b) => `
      <div class="bedgroup">
        <div class="bedhead">Bed ${b.bed}${b.length_ft ? ` · ${b.length_ft} ft long` : ""}</div>
        ${(b.segments || []).map((s) => `
        <div class="bedrow">
          <span class="bcount">${s.print}</span>
          <span class="bname">${s.name}</span>
          <span class="bnote">${s.note || ""}${s.family ? ` · ${s.family}` : ""}${s.tall ? " · tall, north end" : ""}</span>
        </div>`).join("")}
      </div>`).join("");
    if (j.rotation && j.rotation.clashes && j.rotation.clashes.length) {
      beds.innerHTML += `<p class="fine">Rotation flag: ${j.rotation.clashes
        .map((c) => `${c.names.join(" and ")} are both ${c.family}`).join("; ")} — different beds at minimum, and don't follow last year's same family.</p>`;
    } else if (j.rotation) {
      beds.innerHTML += `<p class="fine">Families: ${j.rotation.families.join(", ")} — all different, which is what you want. Next year, move each family to a different bed.</p>`;
    }
    beds.classList.remove("hidden");
  }

  // The plan itself: eight phases, dated. This replaced a flat five-step list and is the whole point.
  const plan = $("#result-steps");
  plan.innerHTML = "";
  (j.phases || []).forEach((p) => {
    const el = document.createElement("section");
    el.className = "phase";
    const steps = (p.steps || []).map((s) => {
      const tag = s.tag ? `<span class="grade">${s.tag}</span>` : "";
      const subs = s.sub && s.sub.length
        ? `<ul class="sub">${s.sub.map((x) => `<li>${x}</li>`).join("")}</ul>`
        : "";
      return `<div class="pstep">${tag}<span>${s.text}</span>${subs}</div>`;
    }).join("");
    el.innerHTML = `<div class="phasehead">
        <span class="pn">${p.n}</span>
        <span class="ptitle">${p.title}</span>
        <span class="pwhen">${p.when}</span>
      </div>
      <p class="pwhy">${p.why}</p>${steps}`;
    plan.appendChild(el);
  });

  const chips = $("#result-window");
  chips.innerHTML = "";
  const windows = (j.harvest_window || []).filter((w) => w.known)
    .slice().sort((a, b) => (a.window_open < b.window_open ? -1 : 1));
  windows.forEach((w) => {
    const el = document.createElement("div");
    el.className = "chip";
    el.innerHTML = `${w.name.toLowerCase()} <b>${fmtDate(w.window_open)}</b>`
      + (w.fit === "stretch" ? ` <span class="muted">stretch</span>` : "");
    chips.appendChild(el);
  });

  const glut = $("#result-glut");
  if (glut) {
    glut.innerHTML = "";
    if (j.glut) {
      let line = `Everything you planted lands between <b>${fmtDate(j.glut.open)}</b> and
        <b>${fmtDate(j.glut.close)}</b>.`;
      if (j.glut.next_season && j.glut.next_season.length) {
        line += ` <span class="muted">And ${j.glut.next_season
          .map((n) => `${n.name.toLowerCase()} comes off ${fmtDate(n.window_open)}, planted this fall
            — that one's its own kind of planning`)
          .join(", ")}.</span>`;
      }
      glut.innerHTML = line;
    }
  }

  const cal = $("#calendar-btn");
  if (cal && windows.length) {
    cal.classList.remove("hidden");
    cal.onclick = (e) => {
      e.preventDefault();
      download("permaculture-harvest-window.ics", icsFor(windows, place));
    };
  }

  const notes = $("#result-notes");
  if (notes && j.notes && j.notes.length) {
    notes.innerHTML = j.notes.map((n) => `<li>${n}</li>`).join("");
    notes.parentElement.classList.remove("hidden");
  }

  const disc = $("#result-disclaimer");
  if (disc) disc.textContent = j.concept_disclaimer;

  els.result.scrollIntoView({ block: "start", behavior: "smooth" });
}

/* ------------------------------------------------------------------ polling + submitting */

async function poll(jobId) {
  try {
    const r = await api(`/api/plan/${jobId}`);
    const j = await r.json();
    if (j.state === "done") {
      clearInterval(pollTimer);
      pollTimer = null;
      renderResult(j);
      api("/api/track", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ event: "plan_result" })
      }).catch(() => {});
      return;
    }
    if (j.state === "error") {
      clearInterval(pollTimer);
      pollTimer = null;
      setQueue({ closed: true, message: j.message || "That one didn't make it. Send the photo again?" });
      say("The render failed on our end — nothing was kept.", true);
      els.go.disabled = false;
      els.go.textContent = "Try again";
      return;
    }
    setQueue({
      position: j.position, eta: j.eta_seconds,
      message: j.message || "Waiting for the machine.",
      closed: j.reason === "forge_down"
    });
  } catch {
    say("Lost the connection to the machine — still trying.", true);
  }
}

function payload() {
  const val = (el, fallback) => (el && el.value && el.value !== "unsure" ? el.value : fallback);
  return {
    images: photos,
    zip: els.zip ? els.zip.value.trim() : "",
    sun: val(els.sun, "unsure"),
    existing: val(els.existing, "unsure"),
    beds: {
      geometry: val(els.bedsType, "unsure"),
      count: val(els.bedsCount, "unsure")
    },
    email: els.email ? els.email.value.trim() : ""
  };
}

async function submit(event) {
  if (event) event.preventDefault();
  if (!photos.length) return say("Pick a photo first.", true);
  const zip = els.zip ? els.zip.value.replace(/\D/g, "") : "";
  if (zip.length !== 5) return say("A five-digit zip code, please — that's what gives you local frost dates.", true);

  els.go.disabled = true;
  els.go.textContent = "Sending…";
  setQueue({ message: "Handing it to the machine…" });

  let r;
  let j;
  try {
    r = await api("/api/plan", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload())
    });
    j = await r.json();
  } catch {
    if (els.queue) els.queue.classList.add("hidden");
    say("Couldn't reach the machine. Check your connection and try again.", true);
    els.go.disabled = false;
    els.go.textContent = "Grow me a plan 🌱";
    return;
  }

  if (r.status === 403 && (j.error === "email_required" || j.error === "week_used")) {
    if (els.queue) els.queue.classList.add("hidden");
    showAllowance(j.status);
    say(j.message, j.error === "week_used");
    els.go.disabled = false;
    els.go.textContent = "Grow me a plan 🌱";
    if (j.error === "email_required" && els.gate) {
      els.gate.classList.remove("hidden");
      els.gate.scrollIntoView({ block: "center", behavior: "smooth" });
      if (els.gateEmail) els.gateEmail.focus();
    }
    return;
  }

  if (!r.ok) {
    if (els.queue) els.queue.classList.add("hidden");
    say(j.message || "Something went sideways.", true);
    els.go.disabled = false;
    els.go.textContent = "Grow me a plan 🌱";
    return;
  }

  showAllowance(j.status);
  if (j.notes && j.notes.length) say("Plan built. " + j.notes[0]);
  els.go.textContent = "In the queue";
  setQueue({ position: j.position, eta: j.eta_seconds, message: j.message || "Waiting for the machine." });
  pollTimer = setInterval(() => poll(j.job_id), 2500);
  poll(j.job_id);
}

/** The email that unlocks the weekly allowance, then tries the render again. */
async function unlock(event) {
  if (event) event.preventDefault();
  const email = els.gateEmail ? els.gateEmail.value.trim() : "";
  if (!email) {
    if (els.gateStatus) els.gateStatus.textContent = "An email address, please.";
    return;
  }
  els.gateBtn.disabled = true;
  els.gateBtn.textContent = "Unlocking…";
  try {
    const r = await api("/api/email", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, zip: els.zip ? els.zip.value.trim() : "", source: "gate" })
    });
    const j = await r.json();
    if (!r.ok) {
      if (els.gateStatus) els.gateStatus.textContent = j.message || "That didn't take.";
      els.gateBtn.disabled = false;
      els.gateBtn.textContent = "Unlock five a week";
      return;
    }
    els.gate.classList.add("hidden");
    showAllowance(j.status);
    say("Unlocked — five plans a week. Drawing yours now.");
    submit();
  } catch {
    if (els.gateStatus) els.gateStatus.textContent = "Couldn't reach the server. Try again in a minute.";
    els.gateBtn.disabled = false;
    els.gateBtn.textContent = "Unlock five a week";
  }
}

/* ------------------------------------------------------------------ photo picking */

function readFiles(fileList) {
  for (const file of Array.from(fileList || [])) {
    if (photos.length >= MAX_PHOTOS) {
      say(`${MAX_PHOTOS} photos is the limit — that's plenty to work from.`);
      break;
    }
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      say(`${file.name} isn't a JPEG, PNG or WebP.`, true);
      continue;
    }
    if (file.size > 6 * 1024 * 1024) {
      say(`${file.name} is over 6 MB. Most phones can shrink it when they send it.`, true);
      continue;
    }
    const fr = new FileReader();
    fr.onload = () => {
      photos.push(String(fr.result));
      drawThumbs();
      els.go.disabled = false;
      say(`${photos.length} photo${photos.length === 1 ? "" : "s"} ready.${photos.length < MAX_PHOTOS ? " Add another angle if you like." : ""}`);
    };
    fr.readAsDataURL(file);
  }
}

function drawThumbs() {
  if (!els.thumbs) return;
  els.thumbs.classList.toggle("hidden", photos.length === 0);
  els.thumbs.innerHTML = photos.map((src, i) => `
    <figure class="thumb">
      <img src="${src}" alt="Photo ${i + 1}">
      <button type="button" data-remove="${i}" title="Remove">×</button>
    </figure>`).join("");
  els.thumbs.querySelectorAll("[data-remove]").forEach((b) => {
    b.onclick = () => {
      photos.splice(Number(b.dataset.remove), 1);
      drawThumbs();
      if (!photos.length) els.go.disabled = true;
    };
  });
}

/* ------------------------------------------------------------------ wiring */

if (els.form) els.form.addEventListener("submit", submit);
if (els.gateBtn) els.gateBtn.addEventListener("click", unlock);
if (els.gate && els.gate.querySelector("form")) els.gate.querySelector("form").addEventListener("submit", unlock);
if (els.file) els.file.addEventListener("change", (e) => readFiles(e.target.files));
if (els.drop) {
  els.drop.addEventListener("click", () => els.file && els.file.click());
  ["dragenter", "dragover"].forEach((ev) =>
    els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add("hot"); }));
  ["dragleave", "drop"].forEach((ev) =>
    els.drop.addEventListener(ev, () => els.drop.classList.remove("hot")));
  els.drop.addEventListener("drop", (e) => {
    e.preventDefault();
    readFiles(e.dataTransfer && e.dataTransfer.files);
  });
}

// The status line reads the machine's real state, so the site never claims the greenhouse is open
// when it isn't — and when the drawing machine isn't reachable from this address, it says so instead
// of letting someone press a button that cannot work.
const live = $("#live-status");
if (live) {
  api("/api/health").then((r) => r.json()).then((h) => {
    const engine = h.engine === "forge" ? "our own machine" : "the test bench";
    live.textContent = h.forge === "up"
      ? `Maker: ${engine} · open · ${h.plans_today}/${h.daily_cap} plans today`
      : `Maker: ${engine} · resting — leave your email and it'll draw yours when it wakes`;
    live.classList.remove("hidden");
  }).catch(() => {
    live.textContent = "The machine that draws these isn't reachable from this address yet — "
      + "the drawing is done at home, not in a data centre.";
    live.classList.remove("hidden");
    if (els.go) {
      els.go.disabled = true;
      els.go.textContent = "Drawing machine not connected here";
    }
  });
}

// Allowance on arrival, so the price of the second plan is visible before anyone gets there.
if (els.allowance) {
  api("/api/me").then((r) => r.json()).then(showAllowance).catch(() => {});
}

// #demo — a real, already-generated plan instead of asking for a photo first. assets/demo-plan.json is a
// genuine API response with the image captured from a real render, so what a visitor sees is what they'd get.
if (location.hash === "#demo" && els.result) {
  fetch("assets/demo-plan.json")
    .then((r) => r.json())
    .then((j) => {
      document.body.dataset.demoPhoto = "assets/img/sample-before.jpg";
      renderResult({
        plan_image_data_url: j.plan_image_url,
        diagram_svg: j.diagram_svg, layout: j.layout,
        phases: j.phases, bed_plan: j.bed_plan, rotation: j.rotation, geometry_label: j.geometry_label,
        harvest_window: j.harvest_window, glut: j.glut, frost: j.frost,
        notes: j.notes || [], concept_disclaimer: j.concept_disclaimer
      });
      const note = $("#result-demo-note");
      if (note) note.classList.remove("hidden");
    })
    .catch(() => {});
}
