const video   = document.getElementById('video');
const cvCvs   = document.getElementById('cv-canvas');
const mainCvs = document.getElementById('main-canvas');
const ctx     = mainCvs.getContext('2d');

let W = mainCvs.width  = window.innerWidth;
let H = mainCvs.height = window.innerHeight;

window.addEventListener('resize', () => {
  W = mainCvs.width  = window.innerWidth;
  H = mainCvs.height = window.innerHeight;
  initWalls();
});

// HSV threshold for yellow
let HSV = { hmin: 15, hmax: 35, smin: 120, vmin: 100, minArea: 3000 };

let blobs = [];

// ── Smoothing ────────────────────────────────
let trackedBlobs = [];
const LERP = 0.12; // very smooth, low = stable

function smoothBlobs(freshBlobs) {
  const out = [];
  freshBlobs.forEach(nb => {
    let best = null, bestDist = Infinity;
    trackedBlobs.forEach((tb) => {
      const d = (tb.cx - nb.cx) ** 2 + (tb.cy - nb.cy) ** 2;
      if (d < bestDist) { bestDist = d; best = tb; }
    });
    if (best !== null && bestDist < 150 ** 2) {
      out.push({
        cx:    best.cx    + (nb.cx    - best.cx)    * LERP,
        cy:    best.cy    + (nb.cy    - best.cy)    * LERP,
        w:     best.w     + (nb.w     - best.w)     * LERP,
        h:     best.h     + (nb.h     - best.h)     * LERP,
        angle: best.angle + (nb.angle - best.angle) * LERP,
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
  kernel = cv.Mat.ones(3, 3, cv.CV_8U);
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
  updateStickerBodies();

  lo.delete(); hi.delete(); contours.delete(); hierarchy.delete();
}

// ── Matter.js ────────────────────────────────
const { Engine, Runner, Bodies, Body, World } = Matter;

const engine = Engine.create({ gravity: { x: 0, y: 1.5 } });
const world  = engine.world;

let walls         = [];
let stickerBodies = [];
let balls         = [];

const BALL_RADIUS = 12;

function initWalls() {
  walls.forEach(w => World.remove(world, w));
  const T = 60;
  walls = [
    Bodies.rectangle(W / 2, H + T / 2, W, T, { isStatic: true }),
    Bodies.rectangle(-T / 2, H / 2,    T, H, { isStatic: true }),
    Bodies.rectangle(W + T / 2, H / 2, T, H, { isStatic: true }),
  ];
  World.add(world, walls);
}

function updateStickerBodies() {
  stickerBodies.forEach(b => World.remove(world, b));
  stickerBodies = [];

  // same scale as render so boxes align perfectly
  const scale   = Math.min(W / cvCvs.width, H / cvCvs.height);
  const offsetX = (W - cvCvs.width  * scale) / 2;
  const offsetY = (H - cvCvs.height * scale) / 2;

  blobs.forEach(blob => {
    const cx = W - (blob.cx * scale + offsetX);
    const cy = blob.cy * scale + offsetY;
    const bw = blob.w * scale;
    const bh = Math.max(blob.h * scale, 16);

    const body = Bodies.rectangle(cx, cy, bw, bh, {
      isStatic:    true,
      label:       'sticker',
      angle:       -blob.angle,
      restitution: 0.5,
      friction:    0.3,
    });

    World.add(world, body);
    stickerBodies.push(body);
  });
}

function spawnBall() {
  const x = BALL_RADIUS * 2 + Math.random() * (W - BALL_RADIUS * 4);
  const b = Bodies.circle(x, -BALL_RADIUS * 2, BALL_RADIUS, {
    restitution: 0.6,
    friction:    0.05,
    frictionAir: 0.006,
    label:       'ball',
  });
  Body.setVelocity(b, { x: (Math.random() - 0.5) * 2, y: 1 });
  World.add(world, b);
  balls.push(b);

  // cleanup balls off screen
  balls = balls.filter(b => {
    if (b.position.y > H + 100) { World.remove(world, b); return false; }
    return true;
  });

  if (balls.length > 80) World.remove(world, balls.shift());
}

setInterval(spawnBall, 500);
setInterval(detectColor, 50); // 20fps detection, saves CPU
Runner.run(Runner.create(), engine);

// ── Webcam ───────────────────────────────────
async function startWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width:      { ideal: 1280 },
      height:     { ideal: 720  },
      aspectRatio: { ideal: 16/9 }, // force horizontal
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
    initWalls();
    render();
  });
}

// ── Render ───────────────────────────────────
function render() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // fit webcam naturally, centered, no zoom, no crop, no stretch
  const scale   = Math.min(W / video.videoWidth, H / video.videoHeight);
  const offsetX = (W - video.videoWidth  * scale) / 2;
  const offsetY = (H - video.videoHeight * scale) / 2;

  // draw mirrored webcam
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, offsetX, offsetY, video.videoWidth * scale, video.videoHeight * scale);
  ctx.restore();

  // draw sticker collision outlines
  stickerBodies.forEach(b => {
    const v = b.vertices;
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  });

  // draw balls
  balls.forEach(ball => {
    const { x, y } = ball.position;
    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });

  requestAnimationFrame(render);
}

// ── Fullscreen on click ───────────────────────
document.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen();
  }
});

document.addEventListener('fullscreenchange', () => {
  W = mainCvs.width  = window.innerWidth;
  H = mainCvs.height = window.innerHeight;
  initWalls();
});

startWebcam();