// src/service/LandmarkIdentity.ts
export type Landmark = { x: number; y: number; z?: number };
export type Landmarks = Landmark[];

// (Update these to match your FaceMesh indices)
const IDX = {
  leftEyeOuter: 33,
  leftEyeInner: 133,
  rightEyeInner: 362,
  rightEyeOuter: 263,
  noseTip: 1,
  mouthLeft: 61,
  mouthRight: 291,
  upperLip: 13,
  lowerLip: 14,
  chin: 152,
  leftBrowMid: 105,
  rightBrowMid: 334,
};

function dist(a: Landmark, b: Landmark) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(dx, dy, dz);
}
function meanPoint(points: Landmark[]): Landmark {
  const n = points.length;
  const sx = points.reduce((s,p)=>s+p.x,0);
  const sy = points.reduce((s,p)=>s+p.y,0);
  const sz = points.reduce((s,p)=>s+(p.z ?? 0),0);
  return { x: sx/n, y: sy/n, z: sz/n };
}

/** Build a pose/scale normalized vector from landmarks */
export function buildFeatureVector(lm: Landmarks): Float32Array | null {
  const pts = (i: number) => lm[i];
  const LEO = pts(IDX.leftEyeOuter), LEI = pts(IDX.leftEyeInner),
        REI = pts(IDX.rightEyeInner), REO = pts(IDX.rightEyeOuter),
        NOSE = pts(IDX.noseTip),
        MLE = pts(IDX.mouthLeft), MRI = pts(IDX.mouthRight),
        ULP = pts(IDX.upperLip),  LLP = pts(IDX.lowerLip),
        CHN = pts(IDX.chin),
        LBM = pts(IDX.leftBrowMid), RBM = pts(IDX.rightBrowMid);
  if (!LEO || !REO || !MLE || !MRI || !NOSE || !ULP || !LLP || !CHN || !LBM || !RBM) return null;

  // center
  const center = meanPoint([LEO, LEI, REI, REO, NOSE, MLE, MRI, ULP, LLP]);
  const C = (p: Landmark) => ({ x: p.x - center.x, y: p.y - center.y, z: (p.z ?? 0) - (center.z ?? 0) });
  const cLEO=C(LEO), cLEI=C(LEI), cREI=C(REI), cREO=C(REO),
        cNOSE=C(NOSE), cMLE=C(MLE), cMRI=C(MRI),
        cULP=C(ULP),  cLLP=C(LLP),  cCHN=C(CHN),
        cLBM=C(LBM),  cRBM=C(RBM);

  // scale by inter-ocular (outer corners)
  const eyeScale = dist(cLEO, cREO);
  if (eyeScale < 1e-6) return null;
  const N = (p: Landmark) => ({ x: p.x/eyeScale, y: p.y/eyeScale, z: (p.z ?? 0)/eyeScale });

  const nLEO=N(cLEO), nLEI=N(cLEI), nREI=N(cREI), nREO=N(cREO),
        nNOSE=N(cNOSE), nMLE=N(cMLE), nMRI=N(cMRI),
        nULP=N(cULP),  nLLP=N(cLLP),  nCHN=N(cCHN),
        nLBM=N(cLBM),  nRBM=N(cRBM);

  const interOcular = Math.hypot(nREO.x - nLEO.x, nREO.y - nLEO.y);
  const mouthWidth  = Math.hypot(nMRI.x - nMLE.x, nMRI.y - nMLE.y);
  const noseChin    = Math.hypot(nCHN.x - nNOSE.x, nCHN.y - nNOSE.y);
  const browEyeL    = Math.hypot(nLBM.x - nLEO.x, nLBM.y - nLEO.y);
  const browEyeR    = Math.hypot(nRBM.x - nREO.x, nRBM.y - nREO.y);

  return new Float32Array([
    nLEO.x, nLEO.y, nREO.x, nREO.y,
    nLEI.x, nLEI.y, nREI.x, nREI.y,
    nNOSE.x, nNOSE.y,
    nMLE.x, nMLE.y, nMRI.x, nMRI.y,
    nULP.x, nULP.y, nLLP.x, nLLP.y,
    nCHN.x, nCHN.y,
    mouthWidth / (interOcular || 1),
    noseChin   / (interOcular || 1),
    browEyeL   / (interOcular || 1),
    browEyeR   / (interOcular || 1),
  ]);
}

/** Fit baseline mean + (diagonal) variance for a stable, fast distance */
export function fitBaselineDiagonal(samples: Float32Array[]) {
  const d = samples[0].length;
  const mean = new Float32Array(d);
  for (const s of samples) for (let i=0;i<d;i++) mean[i]+=s[i];
  for (let i=0;i<d;i++) mean[i] /= samples.length;

  const varDiag = new Float32Array(d);
  for (const s of samples) for (let i=0;i<d;i++) {
    const diff = s[i] - mean[i];
    varDiag[i] += diff * diff;
  }
  for (let i=0;i<d;i++) varDiag[i] = varDiag[i] / Math.max(samples.length-1, 1) + 1e-3; // +λ

  return { mean, varDiag };
}

/** Mahalanobis with diagonal Σ: sum((x-μ)^2 / σ^2) ^ 1/2 */
export function mahalanobisDiag(x: Float32Array, mean: Float32Array, varDiag: Float32Array) {
  let sum = 0;
  for (let i=0;i<x.length;i++) {
    const z = x[i] - mean[i];
    sum += (z*z) / varDiag[i];
  }
  return Math.sqrt(sum);
}
