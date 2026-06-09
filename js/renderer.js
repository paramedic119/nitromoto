// 描画(Canvas 2D)。カメラがバイクを追従し右へスクロール。
// 地形・ピット・ループ・スプリング・トンネル・ターボ・ゴール・ライバル・
// バイク・パーティクル・演出を描く。
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

    // カメラ：バイクを画面左1/3に置く。縦は緩く追従。左端はコース手前で止める。
    let camX = Math.max(-W * 0.1, bike.x - W * 0.32);
    let camY = bike.y - H * 0.55;
    if (game.shake > 0) {
      camX += (Math.random() - 0.5) * game.shake;
      camY += (Math.random() - 0.5) * game.shake;
    }

    drawSky(camX);
    drawTerrain(track, camX, camY);
    drawTunnels(track, camX, camY);
    drawLoops(track, camX, camY);
    drawSprings(track, camX, camY);
    drawLapFlags(track, camX, camY);
    drawFinish(track, camX, camY);
    drawTurbos(track, camX, camY);
    drawRival(game, camX, camY);
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
    ctx.lineTo(W + 50, H + 50);
    ctx.lineTo(-50, H + 50);
    ctx.closePath();
    ctx.fillStyle = GROUND;
    ctx.fill();
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

  function drawTunnels(track, camX, camY) {
    for (const t of track.tunnels) {
      const sx0 = t.x0 - camX;
      const sx1 = t.x1 - camX;
      if (sx1 < -20 || sx0 > W + 20) continue;
      const cy = t.ceilY - camY;
      // 天井の梁
      ctx.fillStyle = '#2a2118';
      ctx.fillRect(sx0, cy - 26, sx1 - sx0, 26);
      ctx.strokeStyle = GROUND_TOP;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx0, cy);
      ctx.lineTo(sx1, cy);
      ctx.stroke();
      // 端の柱
      ctx.fillStyle = 'rgba(20,16,12,0.6)';
      ctx.fillRect(sx0 - 4, cy - 26, 6, 26);
      ctx.fillRect(sx1 - 2, cy - 26, 6, 26);
    }
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

  function drawSprings(track, camX, camY) {
    for (const s of track.springs) {
      const sx = s.x - camX;
      if (sx < -20 || sx > W + 20) continue;
      const sy = s.y - camY;
      // バネ台（赤白の小ランプ）
      ctx.fillStyle = '#ff5a5a';
      ctx.beginPath();
      ctx.moveTo(sx - 14, sy);
      ctx.lineTo(sx + 14, sy);
      ctx.lineTo(sx + 14, sy - 8);
      ctx.lineTo(sx - 14, sy - 4);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 10, sy - 12);
      ctx.lineTo(sx, sy - 22);
      ctx.lineTo(sx + 10, sy - 12);
      ctx.stroke();
    }
  }

  function drawLapFlags(track, camX, camY) {
    for (let i = 0; i < track.lapBoundaries.length - 1; i++) {
      const wx = track.lapBoundaries[i];
      const sx = wx - camX;
      if (sx < -10 || sx > W + 10) continue;
      const gy = groundScreenY(track, wx, camY);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, gy);
      ctx.lineTo(sx, gy - 50);
      ctx.stroke();
      ctx.fillStyle = '#5ad1ff';
      ctx.beginPath();
      ctx.moveTo(sx, gy - 50);
      ctx.lineTo(sx + 18, gy - 44);
      ctx.lineTo(sx, gy - 38);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawFinish(track, camX, camY) {
    const wx = track.finishX;
    const sx = wx - camX;
    if (sx < -40 || sx > W + 40) return;
    const gy = groundScreenY(track, wx, camY);
    const top = gy - 120;
    // ポール
    ctx.fillStyle = '#ddd';
    ctx.fillRect(sx - 2, top, 4, 120);
    // チェッカー旗
    const cols = 5;
    const rows = 3;
    const cw = 12;
    const ch = 10;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? '#111' : '#fff';
        ctx.fillRect(sx + 2 + c * cw, top + r * ch, cw, ch);
      }
    }
    // 路面のチェッカーライン
    for (let r = 0; r < 6; r++) {
      ctx.fillStyle = r % 2 === 0 ? '#111' : '#fff';
      ctx.fillRect(sx - 6, gy - 6 + r * 2 - 6, 12, 2);
    }
  }

  function drawTurbos(track, camX, camY) {
    for (const n of track.turbos) {
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
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.fillStyle = n.guaranteed ? '#5ad1ff' : '#7cf';
      ctx.fill();
      ctx.strokeStyle = '#eaffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      // ターボ記号「T」
      ctx.fillStyle = '#0a2230';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('T', sx, sy + 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  function drawRival(game, camX, camY) {
    const track = game.track;
    if (game.rivalX <= 0 || game.rivalX >= track.finishX) return;
    const sx = game.rivalX - camX;
    if (sx < -30 || sx > W + 30) return;
    const gy = groundScreenY(track, game.rivalX, camY);
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.translate(sx, gy - 12);
    ctx.fillStyle = '#9aa6c2';
    ctx.fillRect(-13, -8, 26, 8);
    rivalWheel(-9, 4);
    rivalWheel(9, 4);
    ctx.fillStyle = '#cdd6ec';
    ctx.fillRect(-4, -15, 8, 8);
    ctx.restore();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#cdd6ec';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RIVAL', sx, gy - 30);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
  }

  function rivalWheel(x, y) {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#33384a';
    ctx.fill();
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

  // これから来る難所を画面端アイコンで予告
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
    for (const s of game.track.springs) {
      if (s.x > aheadFrom && s.x < aheadTo) icon = '↑';
    }
    for (const t of game.track.tunnels) {
      if (t.x0 > aheadFrom && t.x0 < aheadTo) icon = '▭';
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

    if (bike.firing) {
      ctx.fillStyle = '#ffb14a';
      ctx.beginPath();
      ctx.moveTo(-14, 2);
      ctx.lineTo(-14 - (10 + Math.random() * 14), 0);
      ctx.lineTo(-14, -4);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#e23a3a';
    ctx.fillRect(-14, -8, 28, 8);
    wheel(-10, 4);
    wheel(10, 4);
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
