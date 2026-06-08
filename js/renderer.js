// 描画(Canvas 2D)。カメラがバイクを追従し右へスクロール。
// 地形・ピット・ループ・ニトロ・バイク・パーティクル・マーカー・UI演出を描く。
import { config } from './config.js';

const SKY_TOP = '#1b2a4a';
const SKY_BOT = '#3e5c8a';
const GROUND = '#3a2f25';
const GROUND_TOP = '#6b8f3a';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }
  resize();

  function render(game) {
    const { track, bike } = game;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // カメラ：バイクを画面左1/3に置く。縦は緩く追従。
    let camX = bike.x - W * 0.32;
    let camY = bike.y - H * 0.55;
    if (game.shake > 0) {
      camX += (Math.random() - 0.5) * game.shake;
      camY += (Math.random() - 0.5) * game.shake;
    }

    drawSky(camX);
    drawTerrain(track, camX, camY);
    drawLoops(track, camX, camY);
    drawNitros(track, camX, camY);
    drawBestMarker(game, camX, camY);
    drawLandingMarker(game, camX, camY);
    drawHazardPreview(game, camX);
    drawParticles(game, camX, camY);
    drawBike(game, camX, camY);

    if (game.flash > 0) {
      ctx.globalAlpha = Math.min(0.6, game.flash * 0.6);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  function drawSky(camX) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, SKY_TOP);
    g.addColorStop(1, SKY_BOT);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 遠景の丘(パララックス1層)
    ctx.fillStyle = 'rgba(40,70,110,0.6)';
    const off = -camX * 0.3;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let i = -1; i < W / 80 + 2; i++) {
      const x = i * 80 + (off % 80);
      ctx.lineTo(x, H * 0.55 + Math.sin((x + camX * 0.3) * 0.01) * 40);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  function drawTerrain(track, camX, camY) {
    const p = track.points;
    if (p.length < 2) return;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < p.length; i++) {
      const sx = p[i].x - camX;
      const sy = p[i].y - camY;
      if (!started) {
        ctx.moveTo(sx, sy);
        started = true;
      } else {
        ctx.lineTo(sx, sy);
      }
    }
    // 地面の塗り(ラインの下)
    ctx.lineTo(W + 50, H + 50);
    ctx.lineTo(-50, H + 50);
    ctx.closePath();
    ctx.fillStyle = GROUND;
    ctx.fill();
    // 地表の縁(草色)
    ctx.beginPath();
    started = false;
    for (let i = 0; i < p.length; i++) {
      const sx = p[i].x - camX;
      const sy = p[i].y - camY;
      if (!started) {
        ctx.moveTo(sx, sy);
        started = true;
      } else {
        ctx.lineTo(sx, sy);
      }
    }
    ctx.strokeStyle = GROUND_TOP;
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  function drawLoops(track, camX, camY) {
    for (const lp of track.loops) {
      const sx = lp.cx - camX;
      if (sx < -lp.r * 2 || sx > W + lp.r * 2) continue;
      ctx.beginPath();
      ctx.arc(sx, lp.cy - camY, lp.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,210,90,0.85)';
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, lp.cy - camY, lp.r - 6, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawNitros(track, camX, camY) {
    for (const n of track.nitros) {
      if (n.taken) continue;
      const sx = n.x - camX;
      if (sx < -20 || sx > W + 20) continue;
      const sy = n.y - camY;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(sx, sy, 15, 0, Math.PI * 2);
      ctx.fillStyle = '#7cf';
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.fillStyle = n.guaranteed ? '#5ad1ff' : '#7cf';
      ctx.fill();
      ctx.strokeStyle = '#eaffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawBestMarker(game, camX, camY) {
    if (game.best <= 0) return;
    const worldX = game.best * config.PX_PER_M;
    const sx = worldX - camX;
    if (sx < -10 || sx > W + 10) return;
    const gy = groundScreenY(game.track, worldX, camY);
    ctx.strokeStyle = '#ffd24a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx, gy);
    ctx.lineTo(sx, gy - 70);
    ctx.stroke();
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.moveTo(sx, gy - 70);
    ctx.lineTo(sx + 26, gy - 60);
    ctx.lineTo(sx, gy - 50);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1b2a4a';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('BEST', sx + 4, gy - 58);
  }

  function drawLandingMarker(game, camX, camY) {
    if (game.landingX == null) return;
    const sx = game.landingX - camX;
    const gy = groundScreenY(game.track, game.landingX, camY);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(sx, gy - 80);
    ctx.lineTo(sx, gy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(sx, gy, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // これから来るループ/ギャップを画面端アイコンで予告
  function drawHazardPreview(game, camX) {
    const aheadFrom = camX + W;
    const aheadTo = aheadFrom + 700;
    let icon = null;
    for (const lp of game.track.loops) {
      if (lp.enterX > aheadFrom && lp.enterX < aheadTo) icon = '◯';
    }
    for (const g of game.track.gaps) {
      if (g[0] > aheadFrom && g[0] < aheadTo) icon = '⤴';
    }
    if (!icon) return;
    ctx.fillStyle = 'rgba(255,210,90,0.9)';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(icon + ' !', W - 16, H * 0.4);
    ctx.textAlign = 'left';
  }

  function drawParticles(game, camX, camY) {
    for (const p of game.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - camX - 2, p.y - camY - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawBike(game, camX, camY) {
    const bike = game.bike;
    let px = bike.x - camX;
    let py = bike.y - camY;
    let angle = bike.angle;

    // ループ中は円周上に配置して360度回す
    if (bike.inLoop && game.loopAnim) {
      const lp = game.loopAnim.lp;
      const th = bike.loopT * Math.PI * 2;
      px = lp.cx + lp.r * Math.sin(th) - camX;
      py = lp.cy + lp.r * Math.cos(th) - camY;
      angle = -th;
    }

    ctx.save();
    ctx.translate(px, py - 12);
    ctx.rotate(angle);

    // 炎(ニトロ噴射)
    if (bike.firing) {
      ctx.fillStyle = '#ffb14a';
      ctx.beginPath();
      ctx.moveTo(-14, 2);
      ctx.lineTo(-14 - (10 + Math.random() * 14), 0);
      ctx.lineTo(-14, -4);
      ctx.closePath();
      ctx.fill();
    }

    // 車体
    ctx.fillStyle = '#e23a3a';
    ctx.fillRect(-14, -8, 28, 8);
    // 2輪
    wheel(-10, 4);
    wheel(10, 4);
    // ライダー(簡易)
    ctx.fillStyle = '#ffd24a';
    ctx.fillRect(-4, -16, 8, 8);
    ctx.restore();
  }

  function wheel(x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function groundScreenY(track, worldX, camY) {
    const p = track.points;
    if (p.length < 2) return H * 0.6;
    let lo = 0;
    let hi = p.length - 1;
    if (worldX <= p[0].x) return p[0].y - camY;
    if (worldX >= p[hi].x) return p[hi].y - camY;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (p[mid].x <= worldX) lo = mid;
      else hi = mid - 1;
    }
    const a = p[lo];
    const b = p[lo + 1] || a;
    const t = b.x === a.x ? 0 : (worldX - a.x) / (b.x - a.x);
    return a.y + (b.y - a.y) * t - camY;
  }

  return { render, resize };
}
