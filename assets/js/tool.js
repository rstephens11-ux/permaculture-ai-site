// assets/js/tool.js — the free tool's front end.
//
// The browser holds no key and talks only to our own /api. The photo never leaves as a file upload:
// it is read into a data URL, posted, and the server drops it after the render. That is the privacy
// promise on the page, so keep it true here.

const $ = (s) => document.querySelector(s);

// Where the machine lives. Empty = this origin (the normal case: the Mac serves pages and API together).
// A static host with a home GPU sets apiBase to the tunnel hostname — see assets/js/config.js.
const API_BASE = (window.PA_CONFIG && window.PA_CONFIG.apiBase) || "";
const apiUrl = (path) => `${API_BASE}${path}`;
const api = (path) => fetch(apiUrl(path), { headers: { accept: "application/json" } });

const els = {
  file: $("#file"),
  drop: $("#drop"),
  thumb: $("#thumb"),
  email: $("#email"),
  zip: $("#zip"),
  go: $("#go"),
  form: $("#tool-form"),
  queue: $("#queue"),
  qpos: $("#qpos"),
  qmsg: $("#qmsg"),
  qbar: $("#qbar"),
  qrow: $("#qrow"),
  status: $("#status"),
  result: $("#result")
};

let photoDataUrl = null;
let pollTimer = null;

function fmtDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
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

function renderResult(j) {
  els.queue.classList.add("hidden");
  els.result.classList.remove("hidden");

  const shot = $("#result-shot");
  if (shot) shot.src = j.plan_image_data_url;

  const steps = $("#result-steps");
  steps.innerHTML = "";
  j.steps.forEach((s, i) => {
    const el = document.createElement("div");
    el.className = "step";
    const bits = [];
    if (s.plantVarieties && s.plantVarieties.length) bits.push(`try ${s.plantVarieties.join(", ")}`);
    if (s.companionPlants && s.companionPlants.length) bits.push(`with ${s.companionPlants.slice(0, 3).join(", ")}`);
    if (s.wateringNeeds) bits.push(s.wateringNeeds);
    el.innerHTML = `<div class="num">${i + 1}</div>
      <div class="tx">${s.description}
        ${bits.length ? `<em>${bits.join(" · ")}</em>` : ""}
        <em>${s.category.toLowerCase()}</em>
      </div>`;
    steps.appendChild(el);
  });

  const chips = $("#result-window");
  chips.innerHTML = "";
  (j.harvest_window || [])
    .filter((w) => w.known)
    .slice()
    .sort((a, b) => (a.window_open < b.window_open ? -1 : 1)) // earliest first — it reads as a season
    .forEach((w) => {
    const el = document.createElement("div");
    el.className = "chip";
    el.innerHTML = `${w.name.toLowerCase()} <b>${fmtDate(w.window_open)}</b>`;
    chips.appendChild(el);
  });

  const glut = $("#result-glut");
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
  const disc = $("#result-disclaimer");
  if (disc) disc.textContent = j.concept_disclaimer;

  els.result.scrollIntoView({ block: "start", behavior: "smooth" });
}

async function poll(jobId) {
  try {
    const r = await api(`/api/plan/${jobId}`);
    const j = await r.json();
    if (j.state === "done") {
      clearInterval(pollTimer);
      pollTimer = null;
      renderResult(j);
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
      position: j.position,
      eta: j.eta_seconds,
      message: j.message || "Waiting for the machine.",
      closed: j.reason === "forge_down"
    });
  } catch {
    say("Lost the connection to the machine — still trying.", true);
  }
}

async function submit(event) {
  if (event) event.preventDefault();
  if (!photoDataUrl) {
    say("Pick a photo first.", true);
    return;
  }
  els.go.disabled = true;
  els.go.textContent = "Sending…";
  setQueue({ message: "Handing it to the machine…" });

  try {
    const r = await fetch(apiUrl("/api/plan"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image_data_url: photoDataUrl,
        email: els.email ? els.email.value.trim() : "",
        zip: els.zip ? els.zip.value.trim() : ""
      })
    });
    const j = await r.json();
    if (!r.ok) {
      els.queue.classList.add("hidden");
      say(j.message || "Something went sideways.", true);
      els.go.disabled = false;
      els.go.textContent = "Grow me a plan";
      return;
    }
    els.go.textContent = "In the queue";
    setQueue({ position: j.position, eta: j.eta_seconds, message: j.message || "Waiting for the machine." });
    pollTimer = setInterval(() => poll(j.job_id), 2500);
    poll(j.job_id);
  } catch {
    say("Couldn't reach the machine. Check your connection and try again.", true);
    els.go.disabled = false;
    els.go.textContent = "Grow me a plan";
  }
}

function readFile(file) {
  if (!file) return;
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    say("That isn't a JPEG, PNG or WebP — a photo straight off the phone is perfect.", true);
    return;
  }
  if (file.size > 6 * 1024 * 1024) {
    say("That photo is over 6 MB. Most phones can shrink it when they send it.", true);
    return;
  }
  const fr = new FileReader();
  fr.onload = () => {
    photoDataUrl = String(fr.result);
    if (els.thumb) {
      els.thumb.src = photoDataUrl;
      els.thumb.classList.remove("hidden");
    }
    if (els.drop) {
      const b = els.drop.querySelector("b");
      if (b) b.textContent = file.name.length > 28 ? `${file.name.slice(0, 25)}…` : file.name;
    }
    els.go.disabled = false;
    say("Ready. Add an email if you'd like it sent, then press the button.");
  };
  fr.readAsDataURL(file);
}

if (els.form) els.form.addEventListener("submit", submit);
if (els.file) els.file.addEventListener("change", (e) => readFile(e.target.files[0]));
if (els.drop) {
  els.drop.addEventListener("click", () => els.file && els.file.click());
  ["dragenter", "dragover"].forEach((ev) =>
    els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add("hot"); }));
  ["dragleave", "drop"].forEach((ev) =>
    els.drop.addEventListener(ev, () => els.drop.classList.remove("hot")));
  els.drop.addEventListener("drop", (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });
}

// The status line on the landing page reads the machine's real state, so the site never claims the
// greenhouse is open when it isn't.
const live = $("#live-status");
if (live) {
  api("/api/health").then((r) => r.json()).then((h) => {
    const engine = h.engine === "forge" ? "our own machine" : "the test bench";
    live.textContent = h.forge === "up"
      ? `Maker: ${engine} · open · ${h.plans_today}/${h.daily_cap} plans today`
      : `Maker: ${engine} · resting — leave your email and it'll draw yours when it wakes`;
    live.classList.remove("hidden");
  }).catch(() => {
    // Reached a copy of the site where the machine isn't on this origin yet. Say so, rather than
    // letting someone press a button that silently can't work.
    live.textContent = "The machine that draws these isn't reachable from this address yet — "
      + "the drawing is done at home, not in a data centre.";
    live.classList.remove("hidden");
    if (els.go) {
      els.go.disabled = true;
      els.go.textContent = "Drawing machine not connected here";
    }
  });
}

// #demo — show a real, already-generated plan instead of asking for a photo first. The data in
// assets/demo-plan.json is a genuine API response (same steps, same windows) with the image captured
// from a real render, so what a visitor sees here is what they will get.
if (location.hash === "#demo" && els.result) {
  fetch("assets/demo-plan.json")
    .then((r) => r.json())
    .then((j) => {
      renderResult({
        plan_image_data_url: j.plan_image_url,
        steps: j.steps,
        harvest_window: j.harvest_window,
        glut: j.glut,
        concept_disclaimer: j.concept_disclaimer
      });
      const note = $("#result-demo-note");
      if (note) note.classList.remove("hidden");
    })
    .catch(() => {});
}
