// ═══════════════════════════════════════════════════════════
//  Cover images.
//
//  A phone photo is 3-5 MB and the wrong shape. Rather than ask
//  for a pre-cropped file and hope, every upload is center-cropped
//  to 16:9 and downscaled in the browser before it is stored, so
//  what lands in Firestore is small and uniform no matter what
//  was picked.
// ═══════════════════════════════════════════════════════════

export const COVER_W = 640;
export const COVER_H = 360;          // 16:9
export const COVER_MAX_BYTES = 150 * 1024;

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
 * Turn any picked image into a 16:9 JPEG data URL.
 * Returns { dataUrl, bytes, width, height }.
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
  ctx.imageSmoothingQuality = 'high';
  // JPEG has no alpha; without this, transparent PNGs come out black.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, COVER_W, COVER_H);

  const { sx, sy, sw, sh } = coverCrop(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, COVER_W, COVER_H);

  // Step the quality down until it fits rather than failing on a big photo.
  let dataUrl = '';
  for (const q of [0.78, 0.68, 0.58, 0.48]) {
    dataUrl = canvas.toDataURL('image/jpeg', q);
    if (dataUrl.length * 0.75 <= COVER_MAX_BYTES) break;
  }
  const bytes = Math.round(dataUrl.length * 0.75);
  if (bytes > COVER_MAX_BYTES) {
    throw new Error('Could not compress that image enough — try a simpler picture.');
  }
  return { dataUrl, bytes, width: COVER_W, height: COVER_H };
}
