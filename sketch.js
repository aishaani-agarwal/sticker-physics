const video   = document.getElementById('video');
const cvCvs   = document.getElementById('cv-canvas');
const mainCvs = document.getElementById('main-canvas');
const ctx     = mainCvs.getContext('2d');

let W = mainCvs.width  = window.innerWidth;
let H = mainCvs.height = window.innerHeight;

window.addEventListener('resize', () => {
  W = mainCvs.width  = window.innerWidth;
  H = mainCvs.height = window.innerHeight;
  updateCamTransform();
  initWalls();
});

// ── Settings ─────────────────────────────────
let showWebcam    = true;
let webcamOpacity = 1.0;
let boxOpacity    = 0.45;
let HSV = { hmin: 90, hmax: 130, smin: 30, vmin: 50, minArea: 500 };
let blobs = [];

// camera transform — maps webcam pixels to screen pixels
let camScale = 1, camOffsetX = 0, camOffsetY = 0;

function updateCamTransform() {
  camScale   = Math.min(W / video.videoWidth, H / video.videoHeight);
  camOffsetX = (W - video.videoWidth  * camScale) / 2;
  camOffsetY = (H - video.videoHeight * camScale) / 2;
}

// convert webcam pixel → screen pixel (no mirroring)
function camToScreen(cx, cy) {
  return {
    x: cx * camScale + camOffsetX,
    y: cy * camScale + camOffsetY,
  };
}

// ── Smoothing ────────────────────────────────
let trackedBlobs = [];
const LERP = 0.15;

function smoothBlobs(freshBlobs) {
  const out = [];
  freshBlobs.forEach(nb => {
    let best = null, bestDist = Infinity;
    trackedBlobs.forEach(tb => {
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
let cvReady  = false;
let camReady = false;
let src, hsv, mask, kernel, cvInitialized = false;

// called by opencv.js onload
function onOpenCvReady() {
  cvReady = true;
  console.log('OpenCV ready!');
  tryStartDetection();
}

function tryStartDetection() {
  if (cvReady && camReady) {
    initOpenCV();
    setInterval(detectColor, 50);
    setInterval(rebuildStickerBodies, 300);
    console.log('Detection started!');
  }
}

function initOpenCV() {
  src    = new cv.Mat(cvCvs.height, cvCvs.width, cv.CV_8UC4);
  hsv    = new cv.Mat();
  mask   = new cv.Mat();
  kernel = cv.Mat.ones(3, 3, cv.CV_8U);
  cvInitialized = true;
}

function detectColor() {
  if (!cvInitialized) return;

  const ctx2d = cvCvs.getContext('2d', { willReadFrequently: true });
  ctx2d.drawImage(video, 0, 0, cvCvs.width, cvCvs.height);
  src.data.set(ctx2d.getImageData(0, 0, cvCvs.width, cvCvs.height).data);

  cv.cvtColor(src, hsv, cv.COLOR_RGBA2RGB);
  cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

  const lo = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [HSV.hmin, HSV.smin, HSV.vmin, 0]);
  const hi = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [HSV.hmax, 255, 255, 255]);
  cv.inRange(hsv, lo, hi, mask);
  cv.erode(mask, mask, kernel);
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
        angle: rect.angle * Math.PI / 180,
      });
    }
    cnt.delete();
  }

  blobs = smoothBlobs(freshBlobs);
  lo.delete(); hi.delete(); contours.delete(); hierarchy.delete();
}

// ── Matter.js ────────────────────────────────
const { Engine, Runner, Bodies, Body, World } = Matter;
const engine = Engine.create({ gravity: { x: 0, y: 1.5 } });
const world  = engine.world;

let walls = [], stickerBodies = [], balls = [];
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

function rebuildStickerBodies() {
  stickerBodies.forEach(b => World.remove(world, b));
  stickerBodies = [];

  blobs.forEach(blob => {
    const pos = camToScreen(blob.cx, blob.cy);
    const bw  = blob.w * camScale;
    const bh  = Math.max(blob.h * camScale, 20);

    const body = Bodies.rectangle(pos.x, pos.y, bw, bh, {
      isStatic:    true,
      label:       'sticker',
      angle:       blob.angle,
      restitution: 0.6,
      friction:    0.5,
    });
    World.add(world, body);
    stickerBodies.push(body);
  });
}

function spawnBall() {
  const x = BALL_RADIUS * 2 + Math.random() * (W - BALL_RADIUS * 4);
  const b = Bodies.circle(x, -BALL_RADIUS * 2, BALL_RADIUS, {
    restitution: 0.6,
    friction:    0.5,
    frictionAir: 0.006,
    label:       'ball',
    density:     0.002,
  });
  Body.setVelocity(b, { x: (Math.random() - 0.5) * 2, y: 1 });
  World.add(world, b);
  balls.push(b);
  balls = balls.filter(b => {
    if (b.position.y > H + 100) { World.remove(world, b); return false; }
    return true;
  });
  if (balls.length > 80) World.remove(world, balls.shift());
}

function clearBalls() {
  balls.forEach(b => World.remove(world, b));
  balls = [];
}

setInterval(spawnBall, 100);
Runner.run(Runner.create(), engine);

// ── Panel Toggle ─────────────────────────────
function togglePanel() {
  const panel  = document.getElementById('panel');
  const toggle = document.getElementById('panel-toggle');
  panel.classList.toggle('hidden');
  toggle.classList.toggle('hidden');
  toggle.textContent = panel.classList.contains('hidden') ? '❮' : '❯';
}

// ── Webcam ───────────────────────────────────
async function startWebcam() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width:       { ideal: 1280 },
      height:      { ideal: 720  },
      aspectRatio: { ideal: 16/9 },
      facingMode:  'user',
    }
  });
  video.srcObject = stream;
  video.play();
  video.addEventListener('canplay', () => {
    cvCvs.width  = video.videoWidth;
    cvCvs.height = video.videoHeight;
    updateCamTransform();
    initWalls();
    camReady = true;
    tryStartDetection();
    render();
  });
}

// ── Render ───────────────────────────────────
function render() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  // webcam — no mirroring
  if (showWebcam && webcamOpacity > 0) {
    ctx.save();
    ctx.globalAlpha = webcamOpacity;
    ctx.drawImage(video, camOffsetX, camOffsetY,
      video.videoWidth * camScale, video.videoHeight * camScale);
    ctx.restore();
  }

  // sticker boxes drawn from Matter.js body vertices
  // so they are 100% in sync with physics
  stickerBodies.forEach(b => {
    const v = b.vertices;
    ctx.beginPath();
    ctx.moveTo(v[0].x, v[0].y);
    for (let i = 1; i < v.length; i++) ctx.lineTo(v[i].x, v[i].y);
    ctx.closePath();
    ctx.fillStyle   = `rgba(180,180,180,${boxOpacity})`;
    ctx.strokeStyle = `rgba(255,255,255,${boxOpacity})`;
    ctx.lineWidth   = 2;
    ctx.fill();
    ctx.stroke();
  });

  // balls
  balls.forEach(ball => {
    const { x, y } = ball.position;
    ctx.beginPath();
    ctx.arc(x, y, BALL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });

  requestAnimationFrame(render);
}

// ── Fullscreen ───────────────────────────────
document.addEventListener('fullscreenchange', () => {
  W = mainCvs.width  = window.innerWidth;
  H = mainCvs.height = window.innerHeight;
  updateCamTransform();
  initWalls();
});

startWebcam();