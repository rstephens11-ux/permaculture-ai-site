/* assets/js/overlay.js — drawing 1: the grow plan laid over the visitor's own photo.
 *
 * This is the interesting half of the product, and it is deliberately NOT a diffusion render. The
 * model's contribution was made once, offline, into the sprite sheet (tools/plants-sheet.mjs). What
 * happens here is arithmetic: real spacing from the crop table sets each plant's size, our layout maths
 * sets its position, and an image analysis pass decides WHERE on the photo the plan sits.
 *
 * Ryan's brief: "add it automatically when generated in optimized positions as a reference for the user."
 * So there is no drag tool. The placement is automatic and it is explained on the image itself, because
 * an auto-placed overlay that pretends to be registered to the real beds would be a lie; one that says
 * "this is where the plan goes" is a reference.
 *
 * Three things learned by looking at the output rather than trusting it:
 *   1. A plan of two 12-ft beds is 6 ft wide and 12 ft long — a tall sliver. Forced into the wide ground
 *      region of a typical photo it came out ~156 px across and unreadable. So the orientation is now
 *      CHOSEN: whichever of portrait / landscape fills more of the region.
 *   2. Plants with no shadow read as floating stickers. Every sprite gets a soft contact shadow.
 *   3. The sheet's header and footer need to be inside the fitted height, or they spill off the photo.
 *
 * Nothing here talks to the network except to fetch sprites, and nothing is uploaded. Classic script, no
 * modules — plan.html loads it before tool.js.
 */
(function () {
  "use strict";

  // A plan laid on the ground reads as being ON the ground if it is a little squashed vertically. Text
  // is drawn unsquashed so it stays legible; only the geometry and the sprites take the squeeze.
  const GROUND_SQUASH = 0.82;

  // Sprites are 512px squares with air around the plant, so the plant itself is ~70% of the frame.
  // Scale up by the inverse or every plant comes out undersized against its real spacing.
  const SPRITE_AIR = 1.3;

  // Beyond this many plants in one bed segment the picture turns to mush; the count label carries the rest.
  const MAX_PER_SEGMENT = 7;

  // Sprites are addressed relative to THIS SCRIPT, not the page. A bare "assets/plants/" only resolves
  // when the page sits at the site root — a harness, a preview page or a moved page silently got the
  // placeholder markers instead of the art, with no error anywhere.
  const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || "";
  const SITE_BASE = SCRIPT_SRC.replace(/assets\/js\/[^/]*$/, "");
  const SPRITE_DIR = SITE_BASE + "assets/plants/";

  const PALETTE = {
    Solanaceae: "#8a3a22", Fabaceae: "#3d6b2a", Brassicaceae: "#255f3f", Amaranthaceae: "#7a2f5c",
    Apiaceae: "#8a5a12", Allium: "#4b3a80", Cucurbitaceae: "#8a6512", Poaceae: "#6d5a1e",
    Asteraceae: "#2c5c74", Caprifoliaceae: "#2f6752", Rosaceae: "#8a2f42"
  };

  const spriteCache = {};
  function loadSprite(id) {
    if (spriteCache[id]) return spriteCache[id];
    const p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);      // a crop with no sprite yet degrades to a marker
      img.src = SPRITE_DIR + id + ".png";
    });
    spriteCache[id] = p;
    return p;
  }

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /** How much of this pixel looks like ground you could plant, or lay a plan on. */
  function groundScore(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 236) return 0;                                  // blown-out sky, white fence, snow
    if (max < 46) return 0;                                   // deep shadow, dark building
    if (b > r + 18 && b > g + 8) return 0.05;                 // blue: sky or water
    if (g > r + 12 && g > b + 12) return 0.75;                // green: lawn, beds, foliage
    if (max - min < 34) return 1;                              // grey: gravel, path, bare soil
    if (r >= g && g >= b) return 1;                            // brown: soil, mulch, dry ground
    return 0.25;
  }

  /**
   * Find the biggest rectangle of plantable ground: a coarse grid locates the region, then
   * largest-rectangle-under-a-histogram squares it off. Approximate on purpose — this decides where a
   * reference drawing goes, not a boundary survey.
   */
  function findGround(img) {
    const cols = 72;
    const rows = 72;
    const c = document.createElement("canvas");
    c.width = cols;
    c.height = rows;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, cols, rows);
    let data;
    try {
      data = x.getImageData(0, 0, cols, rows).data;
    } catch {
      return null;                                            // tainted canvas (cross-origin photo)
    }

    // Weight the lower two thirds: that is where ground lives in a photo of a yard.
    const mask = [];
    for (let ry = 0; ry < rows; ry++) {
      const row = [];
      const favour = ry < rows * 0.18 ? 0.35 : ry < rows * 0.34 ? 0.7 : 1;
      for (let rx = 0; rx < cols; rx++) {
        const i = (ry * cols + rx) * 4;
        row.push(groundScore(data[i], data[i + 1], data[i + 2]) * favour >= 0.55 ? 1 : 0);
      }
      mask.push(row);
    }

    let best = { x: 0, y: 0, w: 0, h: 0, area: 0 };
    const heights = new Array(cols).fill(0);
    for (let ry = 0; ry < rows; ry++) {
      for (let rx = 0; rx < cols; rx++) heights[rx] = mask[ry][rx] ? heights[rx] + 1 : 0;
      const stack = [];
      for (let rx = 0; rx <= cols; rx++) {
        const h = rx === cols ? 0 : heights[rx];
        while (stack.length && heights[stack[stack.length - 1]] >= h) {
          const top = stack.pop();
          const left = stack.length ? stack[stack.length - 1] + 1 : 0;
          const w = rx - left;
          const area = heights[top] * w;
          if (area > best.area) best = { x: left, y: ry - heights[top] + 1, w, h: heights[top], area };
        }
        stack.push(rx);
      }
    }

    const scaleX = img.naturalWidth / cols;
    const scaleY = img.naturalHeight / rows;
    const pad = Math.round(Math.min(img.naturalWidth, img.naturalHeight) * 0.03);
    const rect = {
      x: best.x * scaleX + pad,
      y: best.y * scaleY + pad,
      w: best.w * scaleX - pad * 2,
      h: best.h * scaleY - pad * 2
    };

    // Nothing usable found (a close-up of a fence, a dark photo): fall back to the lower middle rather
    // than drawing off the edge.
    if (!(rect.w > img.naturalWidth * 0.42) || !(rect.h > img.naturalHeight * 0.16)) {
      const w = img.naturalWidth * 0.74;
      const h = img.naturalHeight * 0.36;
      return { x: (img.naturalWidth - w) / 2, y: img.naturalHeight * 0.54, w, h, fallback: true };
    }
    return rect;
  }

  /**
   * Draw text clipped to a width, with an ellipsis. Two lines of this drawing came out cut off in the
   * first render — a long place name or a long footer simply ran off the sheet — so nothing is drawn
   * unmeasured any more.
   */
  function clipText(ctx, text, xPos, yPos, maxW, align) {
    let s = String(text || "");
    if (ctx.measureText(s).width <= maxW) {
      ctx.fillText(s, xPos, yPos);
      return s;
    }
    while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    ctx.fillText(s + "…", xPos, yPos);
    return s + "…";
  }

  /** Rounded-rect path on `ctx`, with a hand-rolled fallback for canvases without roundRect. */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.arcTo(x + w, y, x + w, y + rr, rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
    ctx.lineTo(x + rr, y + h);
    ctx.arcTo(x, y + h, x, y + h - rr, rr);
    ctx.lineTo(x, y + rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  /**
   * Where every bed and every segment sits, in feet, for one orientation.
   * Portrait: beds side by side, lengths running down. Landscape: beds stacked, lengths running across.
   * Landscape is what fits a photo's ground region most of the time, which is why it is now a choice
   * rather than an assumption.
   */
  function planSpace(beds, bedWft, pathWft, rotated) {
    const bedLen = Math.max.apply(null, beds.map((b) => b.length_ft || 12));
    const across = beds.length * bedWft + Math.max(0, beds.length - 1) * pathWft;
    const out = [];
    beds.forEach((b, i) => {
      const off = i * (bedWft + pathWft);
      const rect = rotated
        ? { x: 0, y: off, w: bedLen, h: bedWft }
        : { x: off, y: 0, w: bedWft, h: bedLen };
      let used = 0;
      const segs = (b.segments || []).map((seg) => {
        const len = seg.length_ft || 2;
        const r = rotated
          ? { x: used, y: rect.y, w: len, h: rect.h }
          : { x: rect.x, y: used, w: rect.w, h: len };
        used += len;
        return { seg, rect: r };
      });
      out.push({ bed: b, rect, segments: segs });
    });
    return {
      beds: out,
      planW: rotated ? bedLen : across,
      planH: rotated ? across : bedLen,
      rotated: !!rotated
    };
  }

  /** How big a plan of planW×planH feet gets inside `rect`, with the ground squash, and its area. */
  function fit(planW, planH, rect, squash) {
    const aspect = (planW / planH) / (squash || 1);   // width per unit of on-screen height
    let w = rect.w;
    let h = w / aspect;
    if (h > rect.h) { h = rect.h; w = h * aspect; }
    return { w, h, area: w * h };
  }

  /**
   * Draw the plan over the photo. Returns true when it drew something.
   * @param {HTMLCanvasElement} canvas
   * @param {{photoSrc: string, layout: object, geometry: object, meta: object}} input
   */
  async function render(canvas, input) {
    const photoSrc = input.photoSrc;
    const layout = input.layout;
    const geometry = input.geometry || { width_in: 30, path_in: 12, length_ft: 12 };
    const meta = input.meta || {};
    if (!canvas || !layout || !layout.beds || !layout.beds.length || !photoSrc) return false;

    const photo = await loadImg(photoSrc);
    const W = photo.naturalWidth;
    const H = photo.naturalHeight;
    canvas.width = W;
    canvas.height = H;
    const x = canvas.getContext("2d");
    x.drawImage(photo, 0, 0, W, H);

    const bedWft = (geometry.width_in || 30) / 12;
    const pathWft = (geometry.path_in || 12) / 12;
    const beds = layout.beds;

    // --- where it goes, and which way round ---------------------------------------------------------
    const region = findGround(photo) || { x: W * 0.13, y: H * 0.54, w: W * 0.74, h: H * 0.36, fallback: true };
    const portrait = planSpace(beds, bedWft, pathWft, false);
    const landscape = planSpace(beds, bedWft, pathWft, true);
    const fitP = fit(portrait.planW, portrait.planH, region, GROUND_SQUASH);
    const fitL = fit(landscape.planW, landscape.planH, region, GROUND_SQUASH);
    const plan = fitL.area >= fitP.area ? landscape : portrait;
    const size = plan.rotated ? fitL : fitP;

    // Type is sized from the SHEET WIDTH, and the header/footer heights follow the type. The other way
    // round — deriving the font from the height — produced a 47px title on a 528px sheet, which clipped
    // every line. Width is what text has to fit inside, so width is what sets it.
    const fsz = Math.max(9, Math.min(30, size.w * 0.038));
    const subLines = 2;
    const headPad = Math.max(10, fsz * 0.6);
    const headH = Math.round(headPad + fsz * (0.62 + 1.25 * subLines));
    const footH = Math.round(Math.max(16, fsz * 1.5));
    // the bed label sits above the bed, inside the sheet, so it gets its own strip of room
    const bedLabelH = Math.max(12, Math.min(26, size.h * 0.05));
    const chromeH = headH + bedLabelH + footH;
    const room = Math.max(60, region.h - chromeH);
    const blockH = Math.min(size.h, room);
    const blockW = size.w * (blockH / size.h);
    const sheetH = blockH + chromeH;
    const sheetX = region.x + (region.w - blockW) / 2;
    const sheetY = region.y + (region.h - sheetH) / 2;
    const blockX = sheetX;
    const blockY = sheetY + headH + bedLabelH;

    const pxX = blockW / plan.planW;                            // pixels per foot across
    const pxY = blockH / plan.planH;                            // pixels per foot down

    // --- the sheet ----------------------------------------------------------------------------------
    x.save();
    x.shadowColor = "rgba(12, 22, 10, 0.4)";
    x.shadowBlur = Math.max(10, W * 0.012);
    x.shadowOffsetY = Math.max(3, H * 0.004);
    x.fillStyle = "rgba(255, 253, 246, 0.94)";
    roundRect(x, sheetX, sheetY, blockW, sheetH, Math.max(8, W * 0.012));
    x.fill();
    x.restore();
    x.strokeStyle = "rgba(24, 40, 20, 0.85)";
    x.lineWidth = Math.max(1.5, W * 0.0022);
    roundRect(x, sheetX, sheetY, blockW, sheetH, Math.max(8, W * 0.012));
    x.stroke();

    const font = (px, weight) => `${weight || 400} ${Math.max(7, Math.round(px))}px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;
    x.textBaseline = "middle";
    x.textAlign = "left";

    // --- header -------------------------------------------------------------------------------------
    const pad = Math.max(5, blockW * 0.016);
    const innerW = blockW - pad * 2;
    x.fillStyle = "#1d2f18";
    x.font = font(fsz * 1.15, 800);
    const titleY = sheetY + headPad * 0.6 + fsz * 0.62;
    clipText(x, "Planting plan — " + (meta.place || "your patch"), sheetX + pad, titleY, innerW);
    // two measured sub-lines at fixed leading: one long line used to run off the sheet
    const sub1 = meta.frost && meta.frost.known
      ? "last frost " + meta.frost.last_spring_freeze + " · " + meta.frost.frost_free_days + " frost-free days"
      : "no local frost record — dates are general";
    const sub2 = meta.glut && meta.glut.open ? "peak week " + meta.glut.open : "";
    x.font = font(fsz * 0.86, 400);
    x.fillStyle = "#4d5c46";
    clipText(x, sub1, sheetX + pad, titleY + fsz * 1.25, innerW);
    if (sub2) clipText(x, sub2, sheetX + pad, titleY + fsz * 2.5, innerW);

    // --- beds, segments and plants ------------------------------------------------------------------
    const sprites = {};
    for (const b of beds) for (const s of (b.segments || [])) sprites[s.crop] = await loadSprite(s.crop);

    for (const entry of plan.beds) {
      const r = entry.rect;
      const bx = blockX + r.x * pxX;
      const by = blockY + r.y * pxY;
      const bw = Math.max(2, r.w * pxX);
      const bh = Math.max(2, r.h * pxY);

      // the path before this bed: to the left in portrait, above in landscape
      if (entry.bed.n > 1) {
        x.fillStyle = "rgba(120, 112, 88, 0.2)";
        if (plan.rotated) x.fillRect(bx, by - pathWft * pxY, bw, pathWft * pxY);
        else x.fillRect(bx - pathWft * pxX, by, pathWft * pxX, bh);
      }

      x.fillStyle = "#ffffff";
      x.strokeStyle = "#22301c";
      x.lineWidth = Math.max(1.2, W * 0.0016);
      x.fillRect(bx, by, bw, bh);
      x.strokeRect(bx, by, bw, bh);

      // water line down the middle of the bed
      x.save();
      x.strokeStyle = "rgba(60, 120, 170, 0.5)";
      x.setLineDash([6, 5]);
      x.lineWidth = Math.max(1, W * 0.0011);
      x.beginPath();
      if (plan.rotated) { x.moveTo(bx + 2, by + bh / 2); x.lineTo(bx + bw - 2, by + bh / 2); }
      else { x.moveTo(bx + bw / 2, by + 2); x.lineTo(bx + bw / 2, by + bh - 2); }
      x.stroke();
      x.restore();

      // bed label, outside the bed on whichever side has room
      x.fillStyle = "#22301c";
      x.font = font(Math.max(8, Math.min(15, (plan.rotated ? bh : bw) * 0.4)), 700);
      if (plan.rotated) {
        x.textAlign = "right";
        x.fillText("Bed " + entry.bed.n, bx - Math.max(4, bw * 0.012), by + bh / 2);
      } else {
        x.textAlign = "center";
        x.fillText("Bed " + entry.bed.n, bx + bw / 2, by - Math.max(5, bh * 0.03));
      }
      x.textAlign = "left";

      for (const slot of entry.segments) {
        const sr = slot.rect;
        const seg = slot.seg;
        const sx = blockX + sr.x * pxX;
        const sy = blockY + sr.y * pxY;
        const sw = Math.max(2, sr.w * pxX);
        const sh = Math.max(2, sr.h * pxY);
        const ink = PALETTE[seg.family] || "#3c4a34";

        x.fillStyle = hexA(ink, 0.12);
        x.fillRect(sx + 1, sy + 1, sw - 2, sh - 2);

        // plants run along the segment's LONG axis, at their real spacing
        const spaceFt = Math.max(0.7, (seg.spacing_in || 12) / 12);
        const counted = Math.max(1, Math.round((seg.length_ft || 2) / spaceFt));
        const n = Math.min(counted, MAX_PER_SEGMENT);
        const acrossPx = plan.rotated ? sh : sw;
        const img = sprites[seg.crop];

        for (let i = 0; i < n; i++) {
          const cx = plan.rotated ? sx + (i + 0.5) * (sw / n) : sx + sw / 2;
          const cy = plan.rotated ? sy + sh / 2 : sy + (i + 0.5) * (sh / n);
          const spriteW = Math.min(acrossPx * 0.78, spaceFt * pxX * SPRITE_AIR);
          const spriteH = spriteW * 1.12;

          if (img) {
            // contact shadow — without it the plants read as floating stickers
            const swd = spriteW * 0.92;
            const grad = x.createRadialGradient(cx, cy + spriteH * 0.3, 0, cx, cy + spriteH * 0.3, swd / 2);
            grad.addColorStop(0, "rgba(18, 28, 12, 0.32)");
            grad.addColorStop(1, "rgba(18, 28, 12, 0)");
            x.save();
            x.translate(cx, cy + spriteH * 0.3);
            x.scale(1, 0.32);
            x.beginPath();
            x.arc(0, 0, swd / 2, 0, Math.PI * 2);
            x.fillStyle = grad;
            x.fill();
            x.restore();
            x.drawImage(img, cx - spriteW / 2, cy - spriteH / 2, spriteW, spriteH);
          } else {
            // no sprite yet: an honest marker rather than a blank
            x.fillStyle = hexA(ink, 0.5);
            x.beginPath();
            x.arc(cx, cy, Math.max(2.5, acrossPx * 0.12), 0, Math.PI * 2);
            x.fill();
          }
        }

        // the label, with the count when fewer plants were drawn than there are
        const lfs = Math.max(7.5, Math.min(13, acrossPx * 0.42));
        const qty = n < counted ? (seg.print || "") + " (showing " + n + ")" : (seg.print || "");
        x.fillStyle = "#1d2f18";
        x.font = font(lfs, 700);
        if (plan.rotated) {
          x.textAlign = "left";
          x.fillText(seg.name + (n < counted ? "  ×" + counted : ""), sx + sw * 0.02 + 2, sy + lfs * 0.7);
          x.font = font(lfs * 0.8, 400);
          x.fillStyle = "#4d5c46";
          x.fillText(qty, sx + sw * 0.02 + 2, sy + sh - lfs * 0.7);
        } else {
          x.textAlign = "center";
          x.fillText(seg.name, sx + sw / 2, sy + lfs * 0.8);
          x.font = font(lfs * 0.8, 400);
          x.fillStyle = "#4d5c46";
          x.fillText(n < counted ? "×" + counted : (seg.print || ""), sx + sw / 2, sy + sh - lfs * 0.7);
        }
        x.textAlign = "left";
      }
    }

    // --- footer, and the honesty --------------------------------------------------------------------
    x.fillStyle = "#4d5c46";
    x.font = font(Math.max(7.5, footH * 0.34), 400);
    clipText(x, "reference layout, to scale — not a survey of your beds",
      sheetX + pad, sheetY + sheetH - footH * 0.5, innerW);

    return true;
  }

  function hexA(hex, a) {
    const h = hex.replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  window.PAOverlay = {
    render, findGround, planSpace, fit, groundScore, loadSprite,
    GROUND_SQUASH, MAX_PER_SEGMENT
  };
})();
