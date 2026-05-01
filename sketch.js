const video   = document.getElementById('video');
const cvCvs   = document.getElementById('cv-canvas');
const mainCvs = document.getElementById('main-canvas');
const ctx     = mainCvs.getContext('2d');

let W = mainCvs.width  = window.innerWidth;
let H = mainCvs.height = window.innerHeight;

window.addEventListener('resize', () => {
  W = mainCvs.width  = window.innerWidth;
  H = mainCvs.height = window.innerHeight;
});

// HSV threshold values for yellow
let HSV = { hmin: 15, hmax: 35, smin: 120, vmin: 100, minArea: 3000 };

// detected blobs
let blobs = [];

// ── Smoothing ────────────────────────────────
let trackedBlobs = [];
const LERP = 0.2;

function smoothBlobs(freshBlobs) {
  const out = [];

  freshBlobs.forEach(nb => {
    let best = null, bestDist = Infinity;

    trackedBlobs.forEach((tb, i) => {
      const d = (tb.cx - nb.cx) ** 2 + (tb.cy - nb.cy) ** 2;
      if (d < bestDist) { bestDist = d; best = i; }
    });

    if (best !== null && bestDist < 130 ** 2) {
      const tb = trackedBlobs[best];
      out.push({
        cx:    tb.cx    + (nb.cx    - tb.cx)    * LERP,
        cy:    tb.cy    + (nb.cy    - tb.cy)    * LERP,
        w:     tb.w     + (nb.w     - tb.w)     * LERP,
        h:     tb.h     + (nb.h     - tb.h)     * LERP,
        angle: tb.angle + (nb.angle - tb.angle) * LERP,
      });
    } else {
      out.push({ ...nb });
    }
  });

  trackedBlobs = out;
  return out;
}

// ── OpenCV ───────────────────────────────────
let cvReady = false;
let src, hsv, mask, kernel, cvInitialized = false;

function onOpenCvReady() {
  cvReady = true;
  console.log('OpenCV ready!');
}

function initOpenCV() {
  src    = new cv.Mat(cvCvs.height, cvCvs.width, cv.CV_8UC4);
  hsv    = new cv.Mat();
  mask   = new cv.Mat();
  kernel = cv.Mat.ones(5, 5, cv.CV_8U);
  cvInitialized = true;
}

function detectColor() {
  if (!cvReady || !cvInitialized) return;

  const ctx2d = cvCvs.getContext('2d');
  ctx2d.drawImage(video, 0, 0, cvCvs.width, cvCvs.height);

  src.data.set(ctx2d.getImageData(0, 0, cvCvs.width, cvCvs.height).data);

  cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
  cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

  const lo = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [HSV.hmin, HSV.smin, HSV.vmin, 0]);
  const hi = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [HSV.hmax, 255, 255, 255]);
  cv.inRange(hsv, lo, hi, mask);

  cv.erode (mask, mask, kernel);
  cv.dilate(mask, mask, kernel);
  cv.dilate(mask, mask, kernel);

  const contours  = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const freshBlobs = [];
  for (let i = 0; i < contours.size(); i++) {
    const cnt  = contours.get(i);
    const area = cv.contourArea(cnt);
    if (area >= HSV.minArea) {
      const rect = cv.minAreaRect(cnt);
      freshBlobs.push({
        cx:    rect.center.x,
        cy:    rect.center.y,
        w:     Math.max(rect.size.width, rect.size.height),
        h:     Math.min(rect.size.width, rect.size.height),
        angle: rect.angle * (Math.PI / 180),
      });
    }
    cnt.delete();
  }

  blobs = smoothBlobs(freshBlobs);

  lo.delete(); hi.delete(); contours.delete(); hierarchy.delete();
}

// ── Webcam ───────────────────────────────────
async function startWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({ 
    video: { 
      width:  { ideal: 4096 },
      height: { ideal: 2160 },
      facingMode: 'user'
    } 
  });
  video.srcObject = stream;
  video.play();

  video.addEventListener('canplay', () => {
    cvCvs.width  = video.videoWidth;
    cvCvs.height = video.videoHeight;
    console.log('video ready:', video.videoWidth, video.videoHeight);
    initOpenCV();
    render();
  });
}

// ── Render ───────────────────────────────────
function render() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const scale   = Math.min(W / video.videoWidth, H / video.videoHeight);
  const offsetX = (W - video.videoWidth  * scale) / 2;
  const offsetY = (H - video.videoHeight * scale) / 2;

  // draw mirrored webcam
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, offsetX, offsetY, video.videoWidth * scale, video.videoHeight * scale);
  ctx.restore();

  // run color detection
  detectColor();

  // draw detected blobs
  blobs.forEach(blob => {
    const scale   = Math.min(W / cvCvs.width, H / cvCvs.height);
    const offsetX = (W - cvCvs.width  * scale) / 2;
    const offsetY = (H - cvCvs.height * scale) / 2;

    const cx = W - (blob.cx * scale + offsetX);
    const cy = blob.cy * scale + offsetY;
    const bw = blob.w * scale;
    const bh = blob.h * scale;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-blob.angle);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
    ctx.restore();
  });

  requestAnimationFrame(render);
}

startWebcam();