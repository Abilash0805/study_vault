// ═══════════════════════════════════════════════════════════
//  Cover images.
//
//  A phone photo is 3-5 MB and the wrong shape. Rather than ask
//  for a pre-cropped file and hope, every upload is center-cropped
//  to 16:9 and downscaled in the browser before it is stored, so
//  what lands in Firestore is small and uniform no matter what
//  was picked.
// ═══════════════════════════════════════════════════════════

// 1280x720, not 640x360. A store tile is small, but the preview
// page shows the same picture across the full width of the page —
// and a phone at 3x device pixels wants well over a thousand real
// pixels for that. At 640 wide the browser was upscaling it 2x,
// which is exactly what "blurry" looks like.
export const COVER_W = 1280;
export const COVER_H = 720;          // 16:9
export const COVER_MAX_BYTES = 280 * 1024;

const QUALITY_STEPS = [0.86, 0.78, 0.70, 0.62, 0.54, 0.46];

/** Largest 16:9 rectangle inside the source, centred. */
function coverCrop(w, h) {
  const target = COVER_W / COVER_H;
  const source = w / h;
  if (source > target) {              // too wide — trim the sides
    const cw = h * target;
    return { sx: (w - cw) / 2, sy: 0, sw: cw, sh: h };
  }
  const ch = w / target;              // too tall — trim top and bottom
  return { sx: 0, sy: (h - ch) / 2, sw: w, sh: ch };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image Chapter Kit can read.')); };
    img.src = url;
  });
}

/**
 * Downscale in halving steps rather than one jump.
 *
 * A single drawImage from a 4000px photo down to 1280 samples the
 * source far too sparsely, and the result crawls with aliasing —
 * worst of all on the thing most likely to be photographed here,
 * a page of text. Halving until the source is within 2x of the
 * target costs a few extra draws and keeps the detail.
 */
function drawScaled(ctx, img, crop, w, h) {
  let { sx, sy, sw, sh } = crop;
  let src = img;

  while (sw > w * 2 && sh > h * 2) {
    const cw = Math.max(w, Math.round(sw / 2));
    const ch = Math.max(h, Math.round(sh / 2));
    const step = document.createElement('canvas');
    step.width = cw; step.height = ch;
    const sctx = step.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(src, sx, sy, sw, sh, 0, 0, cw, ch);
    src = step; sx = 0; sy = 0; sw = cw; sh = ch;
  }

  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
}

/** Real byte count behind a data URL — the "data:…;base64," prefix isn't base64. */
function bytesOf(dataUrl) {
  const comma = dataUrl.indexOf(',');
  return Math.round((dataUrl.length - comma - 1) * 0.75);
}

/**
 * Encode, or null if the browser doesn't know this format. A browser
 * that cannot write WebP quietly hands back a PNG from toDataURL,
 * so the result is checked rather than assumed.
 */
function encode(canvas, type, q) {
  const url = canvas.toDataURL(type, q);
  return url.startsWith('data:' + type) ? url : null;
}

/**
 * Turn any picked image into a 16:9 data URL.
 * Returns { dataUrl, bytes, width, height, type }.
 *
 * WebP where the browser has it, JPEG everywhere else. WebP is
 * roughly a third smaller at the same visible quality, which is what
 * pays for four times the pixels without the covers getting heavier
 * to download.
 */
export async function makeCover(file) {
  if (!/^image\//.test(file.type)) {
    throw new Error('Pick an image file (JPG, PNG, WebP…).');
  }
  const img = await loadImage(file);
  if (!img.naturalWidth || !img.naturalHeight) {
    throw new Error('That image appears to be empty.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = COVER_W;
  canvas.height = COVER_H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // JPEG has no alpha; without this, transparent PNGs come out black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, COVER_W, COVER_H);

  drawScaled(ctx, img, coverCrop(img.naturalWidth, img.naturalHeight), COVER_W, COVER_H);

  // Step the quality down until it fits rather than failing on a big photo.
  let type = 'image/webp';
  let dataUrl = '';
  for (const q of QUALITY_STEPS) {
    let out = encode(canvas, type, q);
    if (!out && type === 'image/webp') {
      type = 'image/jpeg';
      out = encode(canvas, type, q);
    }
    if (!out) break;
    dataUrl = out;
    if (bytesOf(out) <= COVER_MAX_BYTES) break;
  }

  const bytes = dataUrl ? bytesOf(dataUrl) : 0;
  if (!dataUrl || bytes > COVER_MAX_BYTES) {
    throw new Error('Could not compress that image enough — try a simpler picture.');
  }
  return { dataUrl, bytes, width: COVER_W, height: COVER_H, type };
}
