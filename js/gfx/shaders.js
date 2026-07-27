// 全 GLSL。WebGL2 (GLSL ES 3.00)。
// 雪の見え方はほぼここで決まる。暖かい直射光・青紫の影・きらめき・
// 圧雪のコーデュロイ・アイスの映り込み・カービングの溝。

const V = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
const F = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2DShadow;\n';

/* ------------------------------------------------------------ 共通 */

export const COMMON = /* glsl */`
const float PI = 3.14159265;

float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*0.1031);
  p3 += dot(p3, p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));
  p3 += dot(p3, p3.yzx+33.33);
  return fract((p3.xx+p3.yz)*p3.zy);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x),
             mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for(int i=0;i<5;i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
float fbm3(vec2 p){
  float a = 0.5, s = 0.0;
  for(int i=0;i<3;i++){ s += a*vnoise(p); p *= 2.07; a *= 0.5; }
  return s;
}
`;

// 空。フォグの色にもアイスの映り込みにも使う。
export const SKY = /* glsl */`
uniform vec3 uSunDir;
uniform vec3 uSunColor;

vec3 skyBase(vec3 d){
  float up = clamp(d.y, -1.0, 1.0);
  float h = pow(1.0 - clamp(up, 0.0, 1.0), 3.2);
  vec3 zenith  = vec3(0.115, 0.300, 0.680);
  vec3 mid     = vec3(0.360, 0.560, 0.860);
  vec3 horizon = vec3(0.760, 0.860, 0.960);
  vec3 col = mix(zenith, mid, smoothstep(0.0, 0.55, h));
  col = mix(col, horizon, smoothstep(0.45, 1.0, h));

  float mu = max(dot(d, uSunDir), 0.0);
  // 太陽まわりの前方散乱。空全体が太陽側で暖かくなる。
  col += vec3(1.00, 0.78, 0.48) * pow(mu, 5.0)  * 0.30;
  col += vec3(1.00, 0.90, 0.72) * pow(mu, 48.0) * 0.85;

  // 地平線の下は雪原の照り返しでほぼ白
  col = mix(vec3(0.86, 0.90, 0.98), col, smoothstep(-0.16, 0.03, up));
  return col;
}
`;

/* -------------------------------------------------------------- 空 */

export const skyVS = V + /* glsl */`
out vec2 vNdc;
void main(){
  // 属性なしの全画面三角形
  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2) * 2.0 - 1.0;
  vNdc = p;
  gl_Position = vec4(p, 1.0, 1.0);
}`;

export const skyFS = F + COMMON + SKY + /* glsl */`
in vec2 vNdc;
uniform mat4 uInvViewProj;
uniform vec3 uCamPos;
uniform float uTime;
out vec4 outColor;

void main(){
  vec4 p = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 d = normalize(p.xyz/p.w - uCamPos);

  vec3 col = skyBase(d);

  // --- 太陽そのもの ---
  float mu = dot(d, uSunDir);
  float disk = smoothstep(0.99965, 0.99992, mu);
  col += uSunColor * disk * 14.0;

  // --- 遠景の稜線。スケール感が一気に出る ---
  if (d.y > -0.02) {
    float az = atan(d.z, d.x);
    float el = d.y;
    float ridge = 0.055
      + 0.042*sin(az*1.7+0.4) + 0.028*sin(az*3.3+2.1)
      + 0.020*fbm3(vec2(az*2.6, 3.0)) ;
    float m = smoothstep(ridge+0.004, ridge-0.004, el);
    // 手前にもう 1 枚、少し低くて濃い稜線
    float ridge2 = ridge*0.62 + 0.004*sin(az*5.1+1.2);
    float m2 = smoothstep(ridge2+0.003, ridge2-0.003, el);
    vec3 far  = mix(vec3(0.72,0.80,0.93), vec3(0.94,0.96,1.0), 0.35+0.65*smoothstep(0.0,0.06,el));
    vec3 near = mix(vec3(0.62,0.71,0.88), vec3(0.90,0.93,1.0), 0.5);
    col = mix(col, far,  m*0.85);
    col = mix(col, near, m2*0.75);
  }

  // --- 雲。快晴の日なので薄く、まばらに ---
  if (d.y > 0.015) {
    vec2 uv = uCamPos.xz + d.xz * ((1400.0 - uCamPos.y) / max(d.y, 0.015));
    float n = fbm(uv * 0.00042 + vec2(uTime*0.0016, 0.0));
    float c = smoothstep(0.58, 0.86, n) * smoothstep(0.015, 0.16, d.y);
    float lit = 0.72 + 0.28*smoothstep(0.0,0.5,dot(d,uSunDir));
    col = mix(col, vec3(1.0,0.99,0.98)*lit, c*0.80);
  }

  outColor = vec4(col, 1.0);
}`;

/* ------------------------------------------------------------ 影 */

export const SHADOW = /* glsl */`
uniform sampler2DShadow uShadowMap;
uniform mat4 uLightViewProj;
uniform float uShadowTexel;

float shadowAt(vec3 worldPos, float ndl){
  vec4 lp = uLightViewProj * vec4(worldPos, 1.0);
  vec3 c = lp.xyz / lp.w * 0.5 + 0.5;
  if (c.x < 0.002 || c.x > 0.998 || c.y < 0.002 || c.y > 0.998 || c.z > 1.0) return 1.0;
  float bias = mix(0.0026, 0.0007, ndl);
  c.z -= bias;
  float s = 0.0;
  for (int y=-1; y<=1; y++)
    for (int x=-1; x<=1; x++)
      s += texture(uShadowMap, vec3(c.xy + vec2(x,y)*uShadowTexel, c.z));
  // シャドウマップの端で影が途切れると、画面を横切る不自然な線になる。
  // 外側へ向かって「影なし」へ溶かす。
  vec2 e = abs(c.xy - 0.5) * 2.0;
  float inside = 1.0 - smoothstep(0.72, 0.99, max(e.x, e.y));
  return mix(1.0, s / 9.0, inside);
}
`;

// 大気。すべての不透明パスで同じ式を使い、地平が空へ溶けるようにする。
export const FOG = /* glsl */`
uniform float uFogDensity;
uniform float uFogHeight;

vec3 applyFog(vec3 col, vec3 worldPos, vec3 camPos, vec3 viewDir){
  float dist = length(worldPos - camPos);
  // 高さで薄くなる指数フォグ
  float hFactor = exp(-max(worldPos.y - camPos.y, -400.0) / uFogHeight);
  float f = 1.0 - exp(-dist * uFogDensity * hFactor);
  f = clamp(f, 0.0, 1.0);
  vec3 fogCol = skyBase(viewDir);
  // 太陽方向は霞が明るく光る
  float mu = max(dot(viewDir, uSunDir), 0.0);
  fogCol += uSunColor * pow(mu, 8.0) * 0.22;
  return mix(col, fogCol, f);
}
`;

// 雪の共通部分。地形・木の下の雪・岩の雪で同じ質感になるようにまとめてある。
export const SNOW_LIGHT = /* glsl */`
uniform vec3 uAmbSky;      // 空からの環境光（青紫）
uniform vec3 uAmbGround;   // 地面の照り返し

// 雪の陰影。直射は暖かく、影は青紫に沈み、わずかに透ける。
vec3 snowShade(vec3 N, vec3 V, vec3 albedo, float shadow, float ao, float rough){
  float ndl = dot(N, uSunDir);
  // 表面下散乱を模したラップライティング
  float wrap = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
  float direct = max(ndl, 0.0) * shadow;

  vec3 col = albedo * uSunColor * direct;
  // 透過（太陽が向こう側にあるとき、雪が内側から光る）
  col += albedo * uSunColor * pow(wrap, 2.6) * 0.20 * mix(0.30, 1.0, shadow);

  // 環境光。上向きは空の青、下向きは雪面の照り返し。
  float hemi = N.y * 0.5 + 0.5;
  col += albedo * mix(uAmbGround, uAmbSky, hemi) * ao;

  // スペキュラ（GGX 近似）。圧雪は艶があり、パウダーは鈍い。
  vec3 H = normalize(uSunDir + V);
  float a = max(rough*rough, 0.002);
  float ndh = max(dot(N, H), 0.0);
  float d = a / (PI * pow(ndh*ndh*(a-1.0)+1.0, 2.0) + 1e-5);
  float fres = 0.03 + 0.97 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  col += uSunColor * d * fres * shadow * max(ndl, 0.0) * 1.6;
  return col;
}
`;

/* ---------------------------------------------------------- 地形 */

export const terrainVS = V + /* glsl */`
layout(location=0) in vec3 aGrid;     // localX, localZ, skirtFlag
layout(location=1) in float aHeight;
layout(location=2) in vec3 aNormal;
layout(location=3) in vec2 aSurf;     // groomed, ice

uniform mat4 uViewProj;
uniform vec2 uChunkOrigin;
uniform float uSkirt;

out vec3 vWorld;
out vec3 vNormal;
out vec2 vSurf;

void main(){
  vec3 w = vec3(uChunkOrigin.x + aGrid.x, aHeight - aGrid.z*uSkirt, uChunkOrigin.y + aGrid.y);
  vWorld = w;
  vNormal = aNormal;
  vSurf = aSurf;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

export const terrainFS = F + COMMON + SKY + SHADOW + FOG + SNOW_LIGHT + /* glsl */`
in vec3 vWorld;
in vec3 vNormal;
in vec2 vSurf;

uniform vec3 uCamPos;
uniform sampler2D uTrail;
uniform vec2 uTrailOrigin;
uniform float uTrailSpan;
uniform float uTime;

out vec4 outColor;

void main(){
  vec3 N = normalize(vNormal);
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  float groomed = clamp(vSurf.x, 0.0, 1.0);
  float ice = clamp(vSurf.y, 0.0, 1.0);
  float powder = 1.0 - groomed;

  // 1 ピクセルが覆うワールド距離。これを使って細部の周波数を落とす。
  // 距離だけでフェードするとモアレが残るので、画面上の密度で判断する（解析的 AA）。
  float px = max(fwidth(vWorld.x), fwidth(vWorld.z));
  float aaDrift = 1.0 - smoothstep(0.32, 1.05, px);   // 吹きだまり（2.4m 周期）
  float aaGrain = 1.0 - smoothstep(0.035, 0.105, px); // 雪粒（0.18m 周期）
  float aaCord  = 1.0 - smoothstep(0.045, 0.130, px); // コーデュロイ（0.25m 周期）
  float detail  = 1.0 - smoothstep(120.0, 420.0, dist);

  // --- カービングの軌跡 ---
  vec2 tuv = fract((vWorld.xz - uTrailOrigin) / uTrailSpan);
  vec2 tr = texture(uTrail, tuv).rg;
  float groove = clamp(tr.r, 0.0, 1.0);       // 溝の深さ
  float berm   = clamp(tr.g, 0.0, 1.0);       // 掻き出された雪

  // --- 表面の凹凸を法線に足す ---
  vec3 Np = N;
  {
    // 大きめのうねり（吹きだまり）
    float e = 0.55;
    vec2 p = vWorld.xz * 0.42;
    float n0 = vnoise(p);
    float gx = (vnoise(p+vec2(e,0.0)) - n0);
    float gz = (vnoise(p+vec2(0.0,e)) - n0);
    Np.x -= gx * 1.8 * powder * aaDrift;
    Np.z -= gz * 1.8 * powder * aaDrift;

    // 中距離で効く大きな起伏（風の吹きだまり）。ここが無いと 40m 先から真っ白になる。
    vec2 p2 = vWorld.xz * 0.075;
    float b0 = vnoise(p2);
    Np.x -= (vnoise(p2+vec2(0.34,0.0)) - b0) * (0.85 + 0.9*powder);
    Np.z -= (vnoise(p2+vec2(0.0,0.34)) - b0) * (0.85 + 0.9*powder);

    // 細かい雪粒
    vec2 q = vWorld.xz * 5.5;
    float m0 = vnoise(q);
    Np.x -= (vnoise(q+vec2(0.6,0.0)) - m0) * (0.55 + 0.9*powder) * aaGrain;
    Np.z -= (vnoise(q+vec2(0.0,0.6)) - m0) * (0.55 + 0.9*powder) * aaGrain;

    // 圧雪のコーデュロイ。落下線に沿った細い筋。圧雪バーンの目印。
    float cord = sin(vWorld.x * 23.0 + vnoise(vWorld.xz*0.06)*3.0);
    Np.x += cord * 0.21 * groomed * aaCord * (1.0 - ice);

    // 軌跡の縁。溝の外側に雪が盛り上がる。
    Np.x += (tr.r - texture(uTrail, tuv + vec2(0.0025, 0.0)).r) * 11.0;
    Np.z += (tr.r - texture(uTrail, tuv + vec2(0.0, 0.0025)).r) * 11.0;
    Np = normalize(Np);
  }

  // --- アルベド ---
  vec3 snowWhite = vec3(0.94, 0.955, 0.995);
  // 雪面のごく緩やかなむら。遠景に階調を残す。
  vec3 albedo = snowWhite * (0.965 + 0.055 * vnoise(vWorld.xz * 0.028));
  // 溝の中は光が入らないので少し暗く、青く沈む
  albedo = mix(albedo, vec3(0.63, 0.72, 0.91), clamp(groove*1.35, 0.0, 1.0) * 0.72);
  // 掻き出された雪は真っ白でふかふか
  albedo = mix(albedo, vec3(0.99, 0.995, 1.0), berm * 0.5);
  // アイスは灰青
  albedo = mix(albedo, vec3(0.70, 0.80, 0.90), ice * 0.7);

  float rough = mix(0.62, 0.34, groomed);
  rough = mix(rough, 0.075, ice);
  rough = mix(rough, 0.70, groove * 0.5);

  float ao = 1.0 - 0.22*(1.0 - N.y) - groove*0.20;
  float shadow = shadowAt(vWorld, max(dot(N, uSunDir), 0.0));

  vec3 col = snowShade(Np, V, albedo, shadow, ao, rough);

  // --- きらめき。視線と光の向きで瞬く氷の粒 ---
  {
    // セルの大きさを画面密度に追従させる。遠くでも「粒」のまま残り、砂嵐にならない。
    float sc = clamp(0.40 / max(px, 1e-4), 5.0, 52.0);
    vec2 cell = floor(vWorld.xz * sc);
    vec2 r = hash22(cell);
    vec3 H = normalize(uSunDir + V);
    // 粒ごとにランダムな法線を持たせる
    vec3 gn = normalize(vec3(r.x*2.0-1.0, 1.4, r.y*2.0-1.0));
    float sp = pow(max(dot(gn, H), 0.0), 620.0);
    float dens = step(0.955 - 0.03*groomed, hash12(cell*1.37));
    col += uSunColor * sp * dens * shadow * 26.0 * detail * (1.0 - groove*0.7);
  }

  // --- アイスは空を映す ---
  if (ice > 0.01) {
    vec3 R = reflect(-V, Np);
    float f = 0.035 + 0.965 * pow(1.0 - max(dot(Np, V), 0.0), 5.0);
    col = mix(col, col*0.55 + skyBase(R) * f * 2.4, ice * 0.72);
  }

  col = applyFog(col, vWorld, uCamPos, -V);
  outColor = vec4(col, 1.0);
}`;

/* ------------------------------------------------------------ 木 */

export const treeVS = V + /* glsl */`
layout(location=0) in vec3 aPos;      // 正規化された木（高さ 1、半径 1）
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in float aAO;
layout(location=4) in vec3 iPos;
layout(location=5) in vec3 iShape;    // height, radius, trunk
layout(location=6) in vec4 iVar;      // lean, leanDir, tint, snow
layout(location=7) in vec2 iPhase;    // phase, kind

uniform mat4 uViewProj;
uniform float uTime;
uniform float uWind;
uniform vec3 uCamPos;

out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out float vAO;
out float vSnow;

void main(){
  // 遠くの木は霧の中で「浮いた点線」に見えてしまうので、縮めて消す。
  float d = distance(iPos.xz, uCamPos.xz);
  float fade = 1.0 - smoothstep(275.0, 375.0, d);
  vec3 p = vec3(aPos.x * iShape.y, aPos.y * iShape.x * fade, aPos.z * iShape.y) * mix(0.0, 1.0, step(0.001, fade));
  vec3 n = normalize(vec3(aNormal.x / max(iShape.y,0.01), aNormal.y / max(iShape.x,0.01),
                          aNormal.z / max(iShape.y,0.01)));

  // 風でしなる。上に行くほど大きく揺れる。
  float t = uTime * 1.35 + iPhase.x;
  float bend = pow(clamp(aPos.y, 0.0, 1.0), 1.8) * iShape.x;
  float sway = (sin(t) * 0.6 + sin(t*2.17+1.3) * 0.4) * uWind * 0.035;
  // 固有の傾き
  float lean = iVar.x;
  p.x += bend * (sway * cos(iPhase.x) + lean * cos(iVar.y));
  p.z += bend * (sway * sin(iPhase.x) + lean * sin(iVar.y));

  vec3 w = iPos + p;
  vWorld = w;
  vNormal = n;
  vColor = aColor * mix(0.82, 1.12, iVar.z);
  vAO = aAO;
  vSnow = iVar.w;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

export const treeFS = F + COMMON + SKY + SHADOW + FOG + /* glsl */`
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in float vAO;
in float vSnow;

uniform vec3 uCamPos;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
out vec4 outColor;

void main(){
  vec3 N = normalize(vNormal);
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // 上を向いた枝には雪が積もる
  float snowMask = smoothstep(0.15, 0.72, N.y) * vSnow;
  snowMask *= 0.35 + 0.65 * smoothstep(0.0, 0.4, hash12(floor(vWorld.xz*3.0)));
  vec3 albedo = mix(vColor, vec3(0.95,0.965,1.0), snowMask);

  float ndl = dot(N, uSunDir);
  float shadow = shadowAt(vWorld, max(ndl,0.0));
  float ao = 1.0 - vAO*0.85;

  vec3 col = albedo * uSunColor * max(ndl, 0.0) * shadow;
  // 針葉の透過。逆光の樹林がふわっと光る。
  float back = max(-ndl, 0.0) * (1.0 - snowMask);
  col += vColor * uSunColor * back * 0.42 * shadow;
  col += albedo * mix(uAmbGround, uAmbSky, N.y*0.5+0.5) * ao;

  // 雪の載った枝はきらつく
  if (snowMask > 0.05) {
    vec3 H = normalize(uSunDir + V);
    col += uSunColor * pow(max(dot(N,H),0.0), 40.0) * snowMask * shadow * 0.5;
  }

  col = applyFog(col, vWorld, uCamPos, -V);
  outColor = vec4(col, 1.0);
}`;

/* --------------------------------------------------------- 小物 */

export const propVS = V + /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in float aAO;
layout(location=4) in vec3 iPos;
layout(location=5) in vec2 iRotScale;

uniform mat4 uViewProj;
out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;
out float vAO;

void main(){
  float c = cos(iRotScale.x), s = sin(iRotScale.x);
  vec3 p = aPos * iRotScale.y;
  p = vec3(p.x*c + p.z*s, p.y, -p.x*s + p.z*c);
  vec3 n = vec3(aNormal.x*c + aNormal.z*s, aNormal.y, -aNormal.x*s + aNormal.z*c);
  vec3 w = iPos + p;
  vWorld = w; vNormal = n; vColor = aColor; vAO = aAO;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

export const propFS = F + COMMON + SKY + SHADOW + FOG + /* glsl */`
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
in float vAO;
uniform vec3 uCamPos;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
out vec4 outColor;

void main(){
  vec3 N = normalize(vNormal);
  vec3 toCam = uCamPos - vWorld;
  vec3 V = toCam / length(toCam);
  float ndl = dot(N, uSunDir);
  float shadow = shadowAt(vWorld, max(ndl,0.0));
  float ao = 1.0 - vAO*0.8;

  vec3 col = vColor * uSunColor * max(ndl,0.0) * shadow;
  col += vColor * mix(uAmbGround, uAmbSky, N.y*0.5+0.5) * ao;
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N,H),0.0), 26.0) * 0.20 * shadow;

  col = applyFog(col, vWorld, uCamPos, -V);
  outColor = vec4(col, 1.0);
}`;

/* ------------------------------------------------------- ライダー */

export const riderVS = V + /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in float aBone;

uniform mat4 uViewProj;
uniform mat4 uBones[10];
uniform vec3 uTint;

out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;

void main(){
  mat4 B = uBones[int(aBone + 0.5)];
  vec4 w = B * vec4(aPos, 1.0);
  vec3 n = normalize(mat3(B) * aNormal);
  vWorld = w.xyz;
  vNormal = n;
  // 真っ白な部分だけをプレイヤー色に置き換える（ジャケットと腕）
  float isJacket = step(0.985, min(min(aColor.r, aColor.g), aColor.b));
  vColor = mix(aColor, uTint, isJacket);
  gl_Position = uViewProj * w;
}`;

export const riderFS = F + COMMON + SKY + SHADOW + FOG + /* glsl */`
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;
uniform vec3 uCamPos;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform float uGhost;
out vec4 outColor;

void main(){
  vec3 N = normalize(vNormal);
  vec3 toCam = uCamPos - vWorld;
  vec3 V = toCam / length(toCam);
  float ndl = dot(N, uSunDir);
  float shadow = shadowAt(vWorld, max(ndl,0.0));

  vec3 col = vColor * uSunColor * max(ndl,0.0) * shadow;
  col += vColor * mix(uAmbGround, uAmbSky, N.y*0.5+0.5);
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N,H),0.0), 34.0) * 0.30 * shadow;
  // 輪郭光。雪の中で人影が沈まないように。
  col += uAmbSky * pow(1.0 - max(dot(N,V),0.0), 3.0) * 0.9;

  col = applyFog(col, vWorld, uCamPos, -V);
  outColor = vec4(col, uGhost);
}`;

/* --------------------------------------------------- 影パス（深度のみ） */

export const shadowTerrainVS = V + /* glsl */`
layout(location=0) in vec3 aGrid;
layout(location=1) in float aHeight;
uniform mat4 uLightViewProj;
uniform vec2 uChunkOrigin;
uniform float uSkirt;
void main(){
  vec3 w = vec3(uChunkOrigin.x + aGrid.x, aHeight - aGrid.z*uSkirt, uChunkOrigin.y + aGrid.y);
  gl_Position = uLightViewProj * vec4(w, 1.0);
}`;

export const shadowTreeVS = V + /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=4) in vec3 iPos;
layout(location=5) in vec3 iShape;
uniform mat4 uLightViewProj;
void main(){
  vec3 p = vec3(aPos.x*iShape.y, aPos.y*iShape.x, aPos.z*iShape.y);
  gl_Position = uLightViewProj * vec4(iPos + p, 1.0);
}`;

export const shadowPropVS = V + /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=4) in vec3 iPos;
layout(location=5) in vec2 iRotScale;
uniform mat4 uLightViewProj;
void main(){
  float c = cos(iRotScale.x), s = sin(iRotScale.x);
  vec3 p = aPos * iRotScale.y;
  p = vec3(p.x*c + p.z*s, p.y, -p.x*s + p.z*c);
  gl_Position = uLightViewProj * vec4(iPos + p, 1.0);
}`;

export const shadowRiderVS = V + /* glsl */`
layout(location=0) in vec3 aPos;
layout(location=3) in float aBone;
uniform mat4 uLightViewProj;
uniform mat4 uBones[10];
void main(){
  gl_Position = uLightViewProj * (uBones[int(aBone+0.5)] * vec4(aPos,1.0));
}`;

export const depthFS = F + `void main(){}`;

/* ------------------------------------------------- パーティクル */

export const particleVS = V + /* glsl */`
layout(location=0) in vec2 aCorner;
layout(location=1) in vec3 iPos;
layout(location=2) in vec4 iData;    // size, life01, kind, seed
layout(location=3) in vec4 iColor;

uniform mat4 uViewProj;
uniform vec3 uCamRight;
uniform vec3 uCamUp;

out vec2 vUV;
out vec4 vColor;
out float vKind;
out vec3 vWorld;

void main(){
  float sz = iData.x;
  vec3 w = iPos + uCamRight * (aCorner.x * sz) + uCamUp * (aCorner.y * sz);
  vUV = aCorner;
  vColor = iColor;
  vKind = iData.z;
  vWorld = w;
  gl_Position = uViewProj * vec4(w, 1.0);
}`;

export const particleFS = F + COMMON + SKY + FOG + /* glsl */`
in vec2 vUV;
in vec4 vColor;
in float vKind;
in vec3 vWorld;
uniform vec3 uCamPos;
out vec4 outColor;

void main(){
  float r2 = dot(vUV, vUV);
  if (r2 > 1.0) discard;
  // ふわっと減衰する円。雪煙は輪郭を持たない。
  float a = pow(1.0 - r2, 1.6);

  vec3 col = vColor.rgb;
  // 太陽を透かす粉雪はきらきらする
  vec3 V = normalize(uCamPos - vWorld);
  float glow = pow(max(dot(-V, uSunDir), 0.0), 8.0);
  col += uSunColor * glow * 0.55 * a;

  float alpha = a * vColor.a;
  vec3 fogged = applyFog(col, vWorld, uCamPos, -V);
  outColor = vec4(fogged, alpha);
}`;

/* ------------------------------------------------------ 軌跡の書き込み */

export const trailVS = V + /* glsl */`
layout(location=0) in vec2 aCorner;     // -1..1
layout(location=1) in vec4 iQuad;       // centerX, centerZ, dirX, dirZ
layout(location=2) in vec3 iSize;       // halfLen, halfWidth, depth

uniform vec2 uOrigin;
uniform float uSpan;
uniform vec2 uWrap;                     // 折り返し描画用のオフセット

out vec2 vUV;
out float vDepth;

void main(){
  vec2 d = normalize(iQuad.zw);
  vec2 n = vec2(-d.y, d.x);
  vec2 p = iQuad.xy + d * (aCorner.y * iSize.x) + n * (aCorner.x * iSize.y);
  vec2 uv = (p - uOrigin) / uSpan + uWrap;
  vUV = aCorner;
  vDepth = iSize.z;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

export const trailFS = F + /* glsl */`
in vec2 vUV;
in float vDepth;
out vec4 outColor;
void main(){
  // 中央が深い溝、両脇が掻き出された雪
  float x = vUV.x;
  float len = 1.0 - vUV.y*vUV.y*0.15;
  float groove = exp(-x*x*4.2) * len;
  float berm = max(0.0, exp(-(abs(x)-0.85)*(abs(x)-0.85)*11.0) - 0.10) * len;
  outColor = vec4(groove * vDepth, berm * vDepth * 0.8, 0.0, 1.0);
}`;

/* ------------------------------------------------------ ポストプロセス */

export const fullscreenVS = V + /* glsl */`
out vec2 vUV;
void main(){
  vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2) * 2.0 - 1.0;
  vUV = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const brightFS = F + /* glsl */`
in vec2 vUV;
uniform sampler2D uTex;
uniform float uThreshold;
out vec4 outColor;
void main(){
  vec3 c = texture(uTex, vUV).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(l - uThreshold, 0.0) / max(l, 1e-4);
  outColor = vec4(c * k, 1.0);
}`;

export const blurFS = F + /* glsl */`
in vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uDir;      // テクセル単位の方向
out vec4 outColor;
void main(){
  // 9 タップのガウシアン（線形サンプリングで 5 フェッチに畳んである）
  vec3 c = texture(uTex, vUV).rgb * 0.2270270;
  c += texture(uTex, vUV + uDir*1.3846153).rgb * 0.3162162;
  c += texture(uTex, vUV - uDir*1.3846153).rgb * 0.3162162;
  c += texture(uTex, vUV + uDir*3.2307692).rgb * 0.0702702;
  c += texture(uTex, vUV - uDir*3.2307692).rgb * 0.0702702;
  outColor = vec4(c, 1.0);
}`;

export const compositeFS = F + COMMON + /* glsl */`
in vec2 vUV;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uBloom2;
uniform float uExposure;
uniform float uBloomAmt;
uniform float uVignette;
uniform float uAberration;
uniform float uGrain;
uniform float uTime;
uniform float uSpeedBlur;
uniform float uFlow;
uniform float uWipe;
uniform vec2 uSunScreen;     // 太陽の画面座標 (0..1)
uniform float uSunVisible;   // 画面内にあるか 0..1
uniform vec3 uGlareColor;
out vec4 outColor;

// ACES フィルミックトーンマップ（近似）
vec3 aces(vec3 x){
  const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}

void main(){
  vec2 uv = vUV;
  vec2 center = uv - 0.5;
  float r = length(center);

  // --- 速度ブラーと色収差をまとめて解く ---
  // 別々に掛けると、CA がブラー結果を上書きして極端な色ズレになる。
  float ca = uAberration * r * r;
  float amt = uSpeedBlur * smoothstep(0.10, 0.75, r);
  vec3 col;
  if (amt > 0.001 || ca > 0.0002) {
    vec3 sum = vec3(0.0);
    float total = 0.0;
    for (int i = 0; i < 10; i++) {
      float t = float(i) / 9.0;
      float s = 1.0 - amt * t * 0.075;
      float w = 1.0 - t * 0.62;
      // チャンネルごとに微妙に違う倍率でサンプルする＝レンズの色収差
      sum.r += texture(uScene, center * (s + ca) + 0.5).r * w;
      sum.g += texture(uScene, center * s + 0.5).g * w;
      sum.b += texture(uScene, center * (s - ca) + 0.5).b * w;
      total += w;
    }
    col = sum / total;
  } else {
    col = texture(uScene, uv).rgb;
  }

  // --- ブルーム ---
  vec3 bloom = texture(uBloom, uv).rgb + texture(uBloom2, uv).rgb * 0.85;
  col += bloom * uBloomAmt;

  // --- 太陽のグレア。明るいところを太陽へ向かって引き伸ばす ---
  if (uSunVisible > 0.001) {
    vec2 dir = (uSunScreen - uv) * 0.115;
    vec3 shafts = vec3(0.0);
    float w = 1.0, tot = 0.0;
    vec2 p = uv;
    for (int i = 0; i < 8; i++) {
      p += dir;
      shafts += texture(uBloom2, p).rgb * w;
      tot += w;
      w *= 0.80;
    }
    shafts /= max(tot, 1e-4);
    float aim = 1.0 - smoothstep(0.0, 1.25, distance(uv, uSunScreen));
    col += shafts * uGlareColor * uSunVisible * (0.20 + 0.55 * aim);
  }

  // --- 露出とトーンマップ ---
  col *= uExposure;
  col = aces(col);

  // --- カラーグレード。FLOW が乗るほど暖かく、彩度が上がる ---
  float lum = dot(col, vec3(0.2126,0.7152,0.0722));
  col = mix(vec3(lum), col, 1.06 + 0.20*uFlow);
  col *= mix(vec3(1.0), vec3(1.045, 1.010, 0.965), uFlow);
  // 影を少しだけ青く持ち上げる（雪の見え方）
  col += vec3(0.010, 0.016, 0.030) * (1.0 - smoothstep(0.0, 0.35, lum));

  // --- 転倒中は白飛び気味に ---
  col = mix(col, vec3(1.0), uWipe * 0.35);
  col = mix(vec3(dot(col, vec3(0.2126,0.7152,0.0722))), col, 1.0 - uWipe*0.5);

  // --- ビネット ---
  col *= 1.0 - uVignette * smoothstep(0.28, 0.95, r);

  // --- フィルムグレイン ---
  float g = hash12(uv * 1024.0 + fract(uTime) * 91.7) - 0.5;
  col += g * uGrain;

  outColor = vec4(col, 1.0);
}`;
