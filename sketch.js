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

function onOpenCvReady() {
  console.log('OpenCV ready!');
}

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
    render();
  });
}

function render() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const scale = Math.max(W / video.videoWidth, H / video.videoHeight);
  const x = (W - video.videoWidth  * scale) / 2;
  const y = (H - video.videoHeight * scale) / 2;

  // mirror the image
  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, x, y, video.videoWidth * scale, video.videoHeight * scale);
  ctx.restore();

  requestAnimationFrame(render);
}

startWebcam();