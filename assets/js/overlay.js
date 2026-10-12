/* assets/js/overlay.js — drawing 1: the grow plan drawn onto the beds in the visitor's own photo.
 *
 * Ryan's brief, in two rounds:
 *   round 1: "the overlay should be over the raised beds ... fill them with cartoon dirt and use the
 *             sprites as references. and then they should label accordingly to the step plans"
 *   round 2: "retain the original image and then do an overlay over that custom to the picture"
 *
 * So the division of labour is now explicit and every part of it was measured:
 *   * QWEN says WHERE. It returns a segmentation mask of the raised beds — a clean two-colour map, which
 *     is the one thing it turned out to be reliable at. Measured: it redraws 44% of the background if
 *     asked to paint the overlay itself, which is why it is NOT asked to paint the overlay itself.
 *   * WE keep the original photograph as the base, find the bed polygons in the mask, fill them with a
 *     generated dirt texture, and plant the sprites at their real spacing from the crop table, scaled by
 *     depth so plants get smaller toward the far edge. All arithmetic, all testable.
 *   * WE draw the labels, numbered, from the same list the step plan uses. The model never draws text,
 *     so a label cannot drift from the step it belongs to.
 *
 * Falls back to laying a plan sheet over the most open ground when there is no mask or no beds in it —
 * a photo of a balcony or an empty lawn still gets an answer.
 *
 * Classic script, no modules: plan.html loads it before tool.js.
 */
(function () {
  "use strict";

  // --- constants ----------------------------------------------------------------------------------

  // A plan laid on the ground reads as being ON the ground if it is squashed vertically a little.
  const GROUND_SQUASH = 0.82;

  // Sprites are 512px squares with air around the plant, so the plant is ~70% of the frame.
  const SPRITE_AIR = 1.3;

  // Beyond this many plants in one bed run the picture turns to mush; the count label carries the rest.
  const MAX_PER_SEGMENT = 7;

  // How much ground one texture tile represents. Soil crumbs at this scale read as soil, not noise.
  const TEXTURE_FT = 3;

  // Sprites and textures are addressed relative to THIS SCRIPT, not the page: a page in a subdirectory
  // silently got placeholder markers instead of art before this.
  const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || "";
  const SITE_BASE = SCRIPT_SRC.replace(/assets\/js\/[^/]*$/, "");
  const SPRITE_DIR = SITE_BASE + "assets/plants/";
  const TEXTURE_DIR = SITE_BASE + "assets/textures/";

  const PALETTE = {
    Solanaceae: "#8a3a22", Fabaceae: "#3d6b2a", Brassicaceae: "#255f3f", Amaranthaceae: "#7a2f5c",
    Apiaceae: "#8a5a12", Allium: "#4b3a80", Cucurbitaceae: "#8a6512", Poaceae: "#6d5a1e",
    Asteraceae: "#2c5c74", Caprifoliaceae: "#2f6752", Rosaceae: "#8a2f42"
  };

  const cache = {};
  function loadFrom(dir, file) {
    const key = dir + file;
    if (cache[key]) return cache[key];
    const p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);       // a crop with no sprite degrades to a marker
      img.src = dir + file;
    });
    cache[key] = p;
    return p;
  }
  const loadSprite = (id) => loadFrom(SPRITE_DIR, id + ".png");
  const loadTexture = (name) => loadFrom(TEXTURE_DIR, (name || "soil-dark") + ".png");

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  const font = (px, weight) => `${weight || 400} ${Math.max(7, Math.round(px))}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;

  /** Draw text clipped to a width, with an ellipsis. Nothing is drawn unmeasured. */
  function clipText(ctx, text, xPos, yPos, maxW) {
    let s = String(text || "");
    if (ctx.measureText(s).width <= maxW) { ctx.fillText(s, xPos, yPos); return; }
    while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    ctx.fillText(s + "…", xPos, yPos);
  }

  function roundRect(ctx, rx, ry, rw, rh, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") { ctx.roundRect(rx, ry, rw, rh, r); return; }
    const q = Math.min(r, rw / 2, rh / 2);
    ctx.moveTo(rx + q, ry);
    ctx.lineTo(rx + rw - q, ry); ctx.arcTo(rx + rw, ry, rx + rw, ry + q, q);
    ctx.lineTo(rx + rw, ry + rh - q); ctx.arcTo(rx + rw, ry + rh, rx + rw - q, ry + rh, q);
    ctx.lineTo(rx + q, ry + rh); ctx.arcTo(rx, ry + rh, rx, ry + rh - q, q);
    ctx.lineTo(rx, ry + q); ctx.arcTo(rx, ry, rx + q, ry, q);
    ctx.closePath();
  }

  function hexA(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  /* ------------------------------------------------------------------ the beds, from the mask */

  /**
   * Connected components of a white-on-black mask, as quads in image pixels.
   *
   * Working resolution is deliberately low (~320px wide) and the per-row spans are taken as MEDIANS over
   * the top and bottom slices of each component, not as raw extremes: a single stray white pixel at the
   * edge of the mask used to throw a corner far off.
   *
   * @returns {Array<{x0,y0,x1,y1,x2,y2,x3,y3, area, cx, cy, wTop, wBot}>}
   *          corners clockwise from the top-left of the bed: 0,1 = far edge; 2,3 = near edge.
   */
  function bedPolysFromMask(maskImg, opts) {
    const o = opts || {};
    const WORK = 320;
    const scale = WORK / maskImg.naturalWidth;
    const w = Math.max(8, Math.round(maskImg.naturalWidth * scale));
    const h = Math.max(8, Math.round(maskImg.naturalHeight * scale));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(maskImg, 0, 0, w, h);

    let px;
    try {
      px = g.getImageData(0, 0, w, h).data;
    } catch {
      return [];                                    // tainted canvas
    }

    // The mask is white-on-black, but tolerate an inverted one: whichever colour is less common wins as
    // "bed" would be a guess, so instead treat the region with an UNBROKEN border of the opposite colour
    // as background — measured masks have always come back white-on-black.
    const on = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) on[i] = px[i * 4] > 127 ? 1 : 0;
    let onCount = 0;
    for (let i = 0; i < w * h; i++) onCount += on[i];
    if (onCount === 0 || onCount > w * h * 0.92) return [];

    const minArea = w * h * (o.minAreaFraction || 0.002);
    const seen = new Uint8Array(w * h);
    const found = [];

    for (let start = 0; start < w * h; start++) {
      if (!on[start] || seen[start]) continue;
      // flood fill
      const stack = [start];
      seen[start] = 1;
      let area = 0;
      let minX = w, maxX = -1, minY = h, maxY = -1;
      const rowsHit = {};
      while (stack.length) {
        const i = stack.pop();
        const y = (i / w) | 0;
        const xx = i % w;
        area++;
        if (xx < minX) minX = xx;
        if (xx > maxX) maxX = xx;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        (rowsHit[y] = rowsHit[y] || []).push(xx);
        if (xx > 0 && on[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack.push(i - 1); }
        if (xx < w - 1 && on[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack.push(i + 1); }
        if (y > 0 && on[i - w] && !seen[i - w]) { seen[i - w] = 1; stack.push(i - w); }
        if (y < h - 1 && on[i + w] && !seen[i + w]) { seen[i + w] = 1; stack.push(i + w); }
      }
      if (area < minArea) continue;
      const spanH = maxY - minY + 1;
      if (spanH < 4 || maxX - minX < 4) continue;

      // median left/right over the top and bottom slices of this component
      const slice = Math.max(1, Math.round(spanH * 0.16));
      const pick = (fromY, toY) => {
        const lefts = [], rights = [];
        for (let y = fromY; y <= toY; y++) {
          const r = rowsHit[y];
          if (!r || !r.length) continue;
          lefts.push(Math.min.apply(null, r));
          rights.push(Math.max.apply(null, r));
        }
        const med = (a) => a.length ? a.slice().sort((p, q) => p - q)[a.length >> 1] : null;
        return [med(lefts), med(rights)];
      };
      const [tl, tr] = pick(minY, minY + slice) || [];
      const [bl, br] = pick(maxY - slice, maxY) || [];
      if (tl == null || bl == null) continue;

      const F = 1 / scale;                          // back to full image pixels
      const poly = {
        x0: tl * F, y0: minY * F, x1: (tr + 1) * F, y1: minY * F,
        x2: (br + 1) * F, y2: (maxY + 1) * F, x3: bl * F, y3: (maxY + 1) * F,
        area: area * F * F,
        cx: ((tl + tr) / 2) * F, cy: ((minY + maxY) / 2) * F,
        wTop: (tr - tl + 1) * F, wBot: (br - bl + 1) * F
      };
      found.push(poly);
    }

    // nearest bed first (largest on screen), which also matches how they are listed
    found.sort((a, b) => b.area - a.area);
    return found.slice(0, o.maxBeds || 6);
  }

  function quadPath(ctx, p) {
    ctx.beginPath();
    ctx.moveTo(p.x0, p.y0);
    ctx.lineTo(p.x1, p.y1);
    ctx.lineTo(p.x2, p.y2);
    ctx.lineTo(p.x3, p.y3);
    ctx.closePath();
  }

  function bbox(p) {
    const xs = [p.x0, p.x1, p.x2, p.x3];
    const ys = [p.y0, p.y1, p.y2, p.y3];
    return {
      x: Math.min.apply(null, xs), y: Math.min.apply(null, ys),
      w: Math.max.apply(null, xs) - Math.min.apply(null, xs),
      h: Math.max.apply(null, ys) - Math.min.apply(null, ys)
    };
  }

  /** Linear interpolation between the far edge (t=0) and the near edge (t=1) of a bed quad. */
  function atDepth(p, t) {
    const left = p.x0 + (p.x3 - p.x0) * t;
    const right = p.x1 + (p.x2 - p.x1) * t;
    const y = p.y0 + (p.y2 - p.y0) * t;
    return { left, right, y, width: right - left };
  }

  function bedCentre(p) {
    return { x: (p.x0 + p.x1 + p.x2 + p.x3) / 4, y: (p.y0 + p.y1 + p.y2 + p.y3) / 4 };
  }

  /* ------------------------------------------------------------------ drawing the beds */

  /**
   * Fill a bed with the dirt texture, shaded so it sits in the photograph's light.
   * The texture is drawn stretched to the bed's bounding box and clipped to the quad — a mild trapezoid
   * distorts it very little and soil has no direction, so this is simpler and more robust than tiling
   * through a perspective transform.
   */
  function fillBed(ctx, poly, tex, bedWft) {
    const bb = bbox(poly);
    ctx.save();
    quadPath(ctx, poly);
    ctx.clip();
    if (tex) {
      // texel density: bump the texture to roughly TEXTURE_FT of ground across the bed, then tile it
      const pxPerFt = poly.wBot / Math.max(0.5, bedWft);
      const tile = Math.max(8, TEXTURE_FT * pxPerFt);
      const stepX = Math.max(24, tile);
      const stepY = Math.max(24, tile * 0.72);      // vertical foreshortening
      for (let gy = bb.y; gy < bb.y + bb.h; gy += stepY) {
        for (let gx = bb.x; gx < bb.x + bb.w; gx += stepX) {
          ctx.drawImage(tex, gx, gy, stepX, stepY);
        }
      }
      // it is soil under a sky: a little darker at the far edge, a little lighter near
      const grad = ctx.createLinearGradient(0, bb.y, 0, bb.y + bb.h);
      grad.addColorStop(0, "rgba(18, 14, 8, 0.30)");
      grad.addColorStop(0.45, "rgba(18, 14, 8, 0.06)");
      grad.addColorStop(1, "rgba(255, 240, 210, 0.10)");
      ctx.fillStyle = grad;
      ctx.fillRect(bb.x, bb.y, bb.w, bb.h);
    } else {
      ctx.fillStyle = "#3a2a1c";
      ctx.fillRect(bb.x, bb.y, bb.w, bb.h);
    }
    ctx.restore();
  }

  /** A soft contact shadow, or the plants read as stickers. */
  function contactShadow(ctx, cx, cy, w) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
    grad.addColorStop(0, "rgba(16, 24, 10, 0.34)");
    grad.addColorStop(1, "rgba(16, 24, 10, 0)");
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, 0.34);
    ctx.beginPath();
    ctx.arc(0, 0, w / 2, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  /**
   * Plant one bed segment into its share of a bed quad.
   * @param {object} p        bed quad
   * @param {object} seg      {crop,name,print,spacing_in,length_ft,rows,family,no}
   * @param {object} opts     {bedWft, bedLenFt, tFrom, tTo, sprite, rowFrac}
   */
  function plantSegment(ctx, p, seg, opts) {
    const { bedWft, tFrom, tTo, sprite } = opts;
    const spaceFt = Math.max(0.6, (seg.spacing_in || 12) / 12);
    const counted = Math.max(1, Math.round((seg.length_ft || 2) / spaceFt));
    const n = Math.min(counted, MAX_PER_SEGMENT);
    const rows = Math.max(1, Math.min(3, seg.rows || 1));
    const ink = PALETTE[seg.family] || "#3c4a34";

    for (let i = 0; i < n; i++) {
      const t = tFrom + (tTo - tFrom) * ((i + 0.5) / n);
      const strip = atDepth(p, t);
      const pxPerFt = strip.width / Math.max(0.5, bedWft);
      // a plant may not be wider than its own spacing, or neighbours overlap into mush
      const spriteW = Math.min(spaceFt * pxPerFt * SPRITE_AIR, strip.width / (rows === 1 ? 1.6 : rows));
      const spriteH = spriteW * 1.12;
      for (let r = 0; r < rows; r++) {
        const cx = strip.left + strip.width * ((r + 0.5) / rows);
        if (sprite) {
          contactShadow(ctx, cx, strip.y + spriteH * 0.26, spriteW * 0.92);
          ctx.drawImage(sprite, cx - spriteW / 2, strip.y - spriteH * 0.72, spriteW, spriteH);
        } else {
          ctx.fillStyle = hexA(ink, 0.5);
          ctx.beginPath();
          ctx.arc(cx, strip.y, Math.max(2.5, spriteW * 0.14), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    return { counted, drawn: n };
  }

  /** A small numbered disc, the same number the step plan uses. */
  function numberBadge(ctx, x, y, n, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,253,246,0.95)";
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, r * 0.22);
    ctx.strokeStyle = "#22301c";
    ctx.stroke();
    ctx.fillStyle = "#1d2f18";
    ctx.font = font(r * 1.15, 800);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), x, y + r * 0.06);
    ctx.restore();
  }

  /** The legend: number, crop, quantity. This is the list the phase steps refer to. */
  function drawLegend(ctx, box, entries, scale) {
    const pad = Math.max(6, 12 * scale);
    const lineH = Math.max(11, 17 * scale);
    const cols = entries.length > 6 ? 2 : 1;
    const perCol = Math.ceil(entries.length / cols);
    const fs = Math.max(8, 11 * scale);
    const w = box.w;
    const h = pad * 2 + perCol * lineH + fs * 1.4;
    const x0 = box.x;
    const y0 = box.y;

    ctx.save();
    ctx.shadowColor = "rgba(12, 22, 10, 0.38)";
    ctx.shadowBlur = 14 * scale;
    ctx.fillStyle = "rgba(255, 253, 246, 0.95)";
    roundRect(ctx, x0, y0, w, h, 8 * scale);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(24, 40, 20, 0.85)";
    ctx.lineWidth = Math.max(1.4, 2 * scale);
    roundRect(ctx, x0, y0, w, h, 8 * scale);
    ctx.stroke();

    ctx.fillStyle = "#1d2f18";
    ctx.font = font(fs * 1.15, 800);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("What goes where", x0 + pad, y0 + pad + fs * 0.7);

    ctx.font = font(fs, 700);
    entries.forEach((e, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const ex = x0 + pad + col * (w / cols);
      const ey = y0 + pad + fs * 1.9 + row * lineH;
      numberBadge(ctx, ex + fs * 0.6, ey, e.no, fs * 0.72);
      ctx.fillStyle = "#1d2f18";
      ctx.font = font(fs, 700);
      ctx.textAlign = "left";
      const maxW = (w / cols) - pad * 2 - fs * 2.2;
      clipText(ctx, e.name + " — " + (e.print || ""), ex + fs * 1.7, ey, maxW);
    });
    return h;
  }

  /* ------------------------------------------------------------------ fallback: a plan sheet */

  function groundScore(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 236) return 0;
    if (max < 46) return 0;
    if (b > r + 18 && b > g + 8) return 0.05;
    if (g > r + 12 && g > b + 12) return 0.75;
    if (max - min < 34) return 1;
    if (r >= g && g >= b) return 1;
    return 0.25;
  }

  /** Biggest rectangle of plantable ground. Used only when there are no beds to draw on. */
  function findGround(img) {
    const cols = 72, rows = 72;
    const c = document.createElement("canvas");
    c.width = cols; c.height = rows;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, cols, rows);
    let data;
    try { data = x.getImageData(0, 0, cols, rows).data; } catch { return null; }
    const m = [];
    for (let ry = 0; ry < rows; ry++) {
      const row = [];
      const favour = ry < rows * 0.18 ? 0.35 : ry < rows * 0.34 ? 0.7 : 1;
      for (let rx = 0; rx < cols; rx++) {
        const i = (ry * cols + rx) * 4;
        row.push(groundScore(data[i], data[i + 1], data[i + 2]) * favour >= 0.55 ? 1 : 0);
      }
      m.push(row);
    }
    let best = { x: 0, y: 0, w: 0, h: 0, area: 0 };
    const heights = new Array(cols).fill(0);
    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) heights[rx] = m[ry][rx] ? heights[rx] + 1 : 0;
      const st = [];
      for (let rx = 0; rx <= cols; rx++) {
        const hh = rx === cols ? 0 : heights[rx];
        while (st.length && heights[st[st.length - 1]] >= hh) {
          const top = st.pop();
          const left = st.length ? st[st.length - 1] + 1 : 0;
          const w = rx - left;
          if (heights[top] * w > best.area) best = { x: left, y: ry - heights[top] + 1, w, h: heights[top], area: heights[top] * w };
        }
        st.push(rx);
      }
    }
    const sx = img.naturalWidth / cols, sy = img.naturalHeight / rows;
    const pad = Math.round(Math.min(img.naturalWidth, img.naturalHeight) * 0.03);
    const rect = { x: best.x * sx + pad, y: best.y * sy + pad, w: best.w * sx - pad * 2, h: best.h * sy - pad * 2 };
    if (!(rect.w > img.naturalWidth * 0.42) || !(rect.h > img.naturalHeight * 0.16)) {
      const w = img.naturalWidth * 0.74, h = img.naturalHeight * 0.36;
      return { x: (img.naturalWidth - w) / 2, y: img.naturalHeight * 0.54, w, h, fallback: true };
    }
    return rect;
  }

  /* ------------------------------------------------------------------ render */

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{photoSrc:string, maskSrc?:string, layout:object, geometry?:object, meta?:object,
   *          texture?:string}} input
   * @returns {Promise<{mode:"beds"|"sheet", beds:number, entries:Array}>}
   */
  async function render(canvas, input) {
    const layout = input.layout;
    const geometry = input.geometry || { width_in: 30, path_in: 12, length_ft: 12 };
    const meta = input.meta || {};
    const failed = { mode: "none", beds: 0, entries: [] };
    if (!canvas || !layout || !layout.beds || !layout.beds.length || !input.photoSrc) return failed;

    const photo = await loadImg(input.photoSrc);
    const W = photo.naturalWidth;
    const H = photo.naturalHeight;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(photo, 0, 0, W, H);

    const bedWft = (geometry.width_in || 30) / 12;
    const beds = layout.beds;
    const scale = Math.max(0.55, Math.min(2.2, W / 1200));

    // Running number for every crop run, in bed order. The step plan uses the same numbers.
    let no = 0;
    const entries = [];
    beds.forEach((b) => (b.segments || []).forEach((s) => {
      no = s.no || (no + 1);
      entries.push({ no, name: s.name, print: s.print, crop: s.crop, family: s.family, bed: b.n });
    }));

    // --- can we draw on real beds? -----------------------------------------------------------------
    let polys = [];
    if (input.maskSrc) {
      try {
        const mask = await loadImg(input.maskSrc);
        polys = bedPolysFromMask(mask, { maxBeds: beds.length });
      } catch { polys = []; }
    }

    if (polys.length) {
      const tex = await loadTexture(input.texture);
      const n = Math.min(polys.length, beds.length);

      for (let i = 0; i < n; i++) {
        const poly = polys[i];
        const bed = beds[i];
        fillBed(ctx, poly, tex, bedWft);

        // bed outline, and its number, outside the bed on whichever side has room
        ctx.save();
        quadPath(ctx, poly);
        ctx.lineWidth = Math.max(1.4, 2.2 * scale);
        ctx.strokeStyle = "rgba(30, 44, 24, 0.55)";
        ctx.stroke();
        ctx.restore();

        const c = bedCentre(poly);
        const labelFs = Math.max(9, Math.min(16, poly.wBot * 0.045));
        ctx.font = font(labelFs, 800);
        ctx.fillStyle = "rgba(255,253,246,0.92)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = "Bed " + bed.n;
        const tw = ctx.measureText(label).width + labelFs * 0.9;
        roundRect(ctx, c.x - tw / 2, poly.y0 - labelFs * 1.5, tw, labelFs * 1.5, labelFs * 0.5);
        ctx.fill();
        ctx.fillStyle = "#1d2f18";
        ctx.fillText(label, c.x, poly.y0 - labelFs * 0.75);

        // walk the bed from the far edge to the near edge, segment by segment
        const totals = (bed.segments || []).reduce((t, s) => t + (s.length_ft || 2), 0) || 1;
        let walk = 0;
        for (const seg of bed.segments || []) {
          const tFrom = walk / totals;
          const tTo = (walk + (seg.length_ft || 2)) / totals;
          walk += seg.length_ft || 2;
          const sprite = await loadSprite(seg.crop);
          plantSegment(ctx, poly, seg, { bedWft, tFrom, tTo, sprite });

          // the number badge, at the crop's own place in the bed
          const mid = atDepth(poly, (tFrom + tTo) / 2);
          const e = entries.find((x) => x.bed === bed.n && x.crop === seg.crop);
          if (e) {
            numberBadge(ctx, mid.left + mid.width * 0.09, mid.y, e.no, Math.max(7, Math.min(13, poly.wBot * 0.038)));
          }
        }
      }

      // legend, below the beds if there is room, else pinned bottom-left
      const lowest = Math.max.apply(null, polys.map((p) => p.y3));
      const legendW = Math.min(W * 0.52, 520 * scale);
      const legendH = Math.max(60, 24 * scale + Math.ceil(entries.length / (entries.length > 6 ? 2 : 1)) * 17 * scale);
      const ly = Math.min(lowest + 12 * scale, H - legendH - 8 * scale);
      drawLegend(ctx, { x: Math.max(8, W * 0.03), y: Math.max(lowest + 12 * scale, ly), w: legendW }, entries, scale);

      ctx.fillStyle = "rgba(28, 38, 22, 0.72)";
      ctx.font = font(10.5 * scale, 400);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      clipText(ctx, "your own photo, with the plan laid on the beds found in it — a reference, not a survey",
        Math.max(8, W * 0.03), H - 8 * scale, W * 0.7);

      return { mode: "beds", beds: n, entries };
    }

    return renderSheet(ctx, { W, H, beds, entries, geometry, bedWft, meta, scale, photo });
  }

  /**
   * Fallback: no mask, or no beds in it. Lay the whole plan out as a sheet over the most open ground,
   * which is what the balcony and empty-lawn cases need.
   */
  function renderSheet(ctx, ctxIn) {
    const { W, H, beds, entries, bedWft, geometry, meta, scale } = ctxIn;
    const pathWft = (geometry.path_in || 12) / 12;

    // work out both orientations and keep the one that fills more of the open ground
    const bedLen = Math.max.apply(null, beds.map((b) => b.length_ft || 12));
    const across = beds.length * bedWft + Math.max(0, beds.length - 1) * pathWft;
    const region = findGround(ctxIn.photo) || { x: W * 0.13, y: H * 0.54, w: W * 0.74, h: H * 0.36, fallback: true };
    const fitOf = (pw, ph) => {
      const aspect = (pw / ph) / GROUND_SQUASH;
      let w = region.w, h = w / aspect;
      if (h > region.h) { h = region.h; w = h * aspect; }
      return { w, h, area: w * h };
    };
    const fitP = fitOf(bedWft, bedLen);
    const fitL = fitOf(bedLen, bedWft);
    const rotated = fitL.area >= fitP.area;
    const fsz = Math.max(9, Math.min(30, (rotated ? fitL : fitP).w * 0.038));
    const headH = Math.round(Math.max(10, fsz * 0.6) + fsz * (0.62 + 1.25 * 2));
    const footH = Math.round(Math.max(16, fsz * 1.5));
    const bedLabelH = Math.max(12, Math.min(26, (rotated ? fitL : fitP).h * 0.05));
    const chrome = headH + bedLabelH + footH;
    const size = rotated ? fitL : fitP;
    const blockH = Math.min(size.h, Math.max(60, region.h - chrome));
    const blockW = size.w * (blockH / size.h);
    const sheetH = blockH + chrome;
    const sheetX = region.x + (region.w - blockW) / 2;
    const sheetY = region.y + (region.h - sheetH) / 2;
    const blockY = sheetY + headH + bedLabelH;
    const pxX = blockW / (rotated ? bedLen : across);
    const pxY = blockH / (rotated ? across : bedLen);

    ctx.save();
    ctx.shadowColor = "rgba(12, 22, 10, 0.4)";
    ctx.shadowBlur = Math.max(10, W * 0.012);
    ctx.fillStyle = "rgba(255, 253, 246, 0.94)";
    roundRect(ctx, sheetX, sheetY, blockW, sheetH, 8 * scale);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "rgba(24, 40, 20, 0.85)";
    ctx.lineWidth = Math.max(1.5, 2.2 * scale);
    roundRect(ctx, sheetX, sheetY, blockW, sheetH, 8 * scale);
    ctx.stroke();

    const pad = Math.max(5, blockW * 0.016);
    const innerW = blockW - pad * 2;
    const titleY = sheetY + Math.max(10, fsz * 0.6) * 0.6 + fsz * 0.62;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#1d2f18";
    ctx.font = font(fsz * 1.15, 800);
    clipText(ctx, "Planting plan — " + (meta.place || "your patch"), sheetX + pad, titleY, innerW);
    const sub1 = meta.frost && meta.frost.known
      ? "last frost " + meta.frost.last_spring_freeze + " · " + meta.frost.frost_free_days + " frost-free days"
      : "no local frost record — dates are general";
    const sub2 = meta.glut && meta.glut.open ? "peak week " + meta.glut.open : "";
    ctx.font = font(fsz * 0.86, 400);
    ctx.fillStyle = "#4d5c46";
    clipText(ctx, sub1, sheetX + pad, titleY + fsz * 1.25, innerW);
    if (sub2) clipText(ctx, sub2, sheetX + pad, titleY + fsz * 2.5, innerW);

    let drawn = 0;
    beds.forEach((bed, i) => {
      const off = i * (bedWft + pathWft);
      const rx = rotated ? 0 : off, ry = rotated ? off : 0;
      const rw = rotated ? bedLen : bedWft, rh = rotated ? bedWft : bedLen;
      const bx = sheetX + rx * pxX, by = blockY + ry * pxY;
      const bw = Math.max(2, rw * pxX), bh = Math.max(2, rh * pxY);

      if (i > 0) {
        ctx.fillStyle = "rgba(120, 112, 88, 0.2)";
        if (rotated) ctx.fillRect(bx, by - pathWft * pxY, bw, pathWft * pxY);
        else ctx.fillRect(bx - pathWft * pxX, by, pathWft * pxX, bh);
      }
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "#22301c";
      ctx.lineWidth = Math.max(1.2, 1.6 * scale);
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeRect(bx, by, bw, bh);
      ctx.fillStyle = "#22301c";
      ctx.font = font(Math.max(8, Math.min(15, (rotated ? bh : bw) * 0.4)), 700);
      if (rotated) { ctx.textAlign = "right"; ctx.fillText("Bed " + bed.n, bx - Math.max(4, bw * 0.012), by + bh / 2); }
      else { ctx.textAlign = "center"; ctx.fillText("Bed " + bed.n, bx + bw / 2, by - Math.max(5, bh * 0.03)); }
      ctx.textAlign = "left";

      const totals = (bed.segments || []).reduce((t, s) => t + (s.length_ft || 2), 0) || 1;
      let walk = 0;
      for (const seg of bed.segments || []) {
        const len = seg.length_ft || 2;
        const sx = rotated ? bx + (walk / totals) * bw : bx;
        const sy = rotated ? by : by + (walk / totals) * bh;
        const sw = rotated ? (len / totals) * bw : bw;
        const sh = rotated ? bh : (len / totals) * bh;
        walk += len;
        const ink = PALETTE[seg.family] || "#3c4a34";
        ctx.fillStyle = hexA(ink, 0.12);
        ctx.fillRect(sx + 1, sy + 1, sw - 2, sh - 2);
        const mid = rotated
          ? { left: sx, width: sw, y: sy + sh / 2 }
          : { left: sx, width: sw, y: sy + sh / 2 };
        plantSegment(ctx, {
          x0: mid.left, y0: mid.y, x1: mid.left + mid.width, y1: mid.y,
          x2: mid.left + mid.width, y2: mid.y, x3: mid.left, y3: mid.y
        }, Object.assign({}, seg, { rows: 1 }), { bedWft, tFrom: 0, tTo: 0, sprite: null });
        drawn++;
      }
    });

    const legendH = Math.max(60, 24 * scale + Math.ceil(entries.length / (entries.length > 6 ? 2 : 1)) * 17 * scale);
    drawLegend(ctx, {
      x: sheetX, y: Math.min(sheetY + sheetH + 12 * scale, H - legendH - 8 * scale),
      w: Math.min(W * 0.52, 520 * scale)
    }, entries, scale);

    ctx.fillStyle = "#4d5c46";
    ctx.font = font(Math.max(7.5, footH * 0.34), 400);
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    clipText(ctx, "reference layout, to scale — laid over the most open ground in your photo",
      sheetX + pad, sheetY + sheetH - footH * 0.5, innerW);

    return { mode: "sheet", beds: drawn, entries };
  }

  window.PAOverlay = {
    render, bedPolysFromMask, planSegments: null, findGround, groundScore,
    loadSprite, loadTexture, GROUND_SQUASH, MAX_PER_SEGMENT, TEXTURE_FT
  };
})();
