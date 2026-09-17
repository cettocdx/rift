"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * The hero object: a world with work in orbit around it.
 *
 * What was here was a corridor — receding architecture, which is a fine image
 * and the wrong one. A corridor says "a building." This page is about handing
 * a job to a machine somewhere and getting it back finished, and there is one
 * image that says that without a caption: a sphere, points of light on it, and
 * traffic arcing between them.
 *
 * Four things are drawn, and each is doing a specific job:
 *
 *   1. `surface` — a fibonacci-distributed point cloud, which is the only
 *      distribution that puts points evenly on a sphere. Latitude/longitude
 *      grids bunch at the poles and the eye reads the bunching instantly as a
 *      mistake.
 *   2. `atmosphere` — a slightly larger sphere rendered *inside out* with an
 *      additive fresnel. The classic trick, and it is the entire reason the
 *      globe looks photographed rather than modelled: light gathers where the
 *      surface turns away from the camera, which is what a real limb does.
 *   3. `arcs` — great-circle-ish curves lifted off the surface, each carrying
 *      a travelling head. A run leaving, and a run coming back.
 *   4. `stars` — a very sparse field, dim. Without them the sphere floats in a
 *      void; with too many it turns into a screensaver.
 *
 * Cost control, because this sits behind the headline on every visit:
 *   • One rAF, gated by an IntersectionObserver *and* by `document.hidden`.
 *   • Two draw-call groups for the arcs total, not one per arc.
 *   • Everything disposed on unmount — geometries, materials, the renderer,
 *     and the canvas's own WebGL context.
 *   • `prefers-reduced-motion` stops the clock and renders one still frame,
 *     which is a composition in its own right rather than a blank div.
 */

const SURFACE_POINTS = 2600;
const ARC_COUNT = 11;
const ARC_SEGMENTS = 64;
const STAR_COUNT = 420;
const RADIUS = 1;

/** Deterministic, so the composition is the same for every visitor. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Fibonacci sphere. `i + 0.5` rather than `i` matters: without the half-step
 * the first and last points land exactly on the poles and the cloud gets two
 * visible pinpricks.
 */
function fibonacciPoint(i: number, total: number): THREE.Vector3 {
  const phi = Math.acos(1 - (2 * (i + 0.5)) / total);
  const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5);
  return new THREE.Vector3(
    Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  );
}

export function XGlobe({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
    } catch {
      // No WebGL. The section's own atmosphere and wash still compose, so the
      // hero degrades to a still rather than to a hole.
      return;
    }

    renderer.setClearColor(0x000000, 0);
    // Capped below devicePixelRatio: this is a soft, low-contrast object and
    // there is nothing at 3× for a retina pass to resolve except heat.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.5, 4.15);
    camera.lookAt(0, 0.06, 0);

    /**
     * The whole object is tilted and lives in one group, so the rotation is a
     * single quaternion update per frame rather than five.
     */
    const world = new THREE.Group();
    world.rotation.z = 0.22;
    // Dropped below the camera's axis so only the top of the planet is in
    // frame and the rest of the hero is sky. This is the composition; the
    // wrapper is just a full-bleed box.
    world.position.y = -1.16;
    scene.add(world);

    const rand = rng(20260822);
    const disposables: { dispose: () => void }[] = [];

    // ── 1. Surface ────────────────────────────────────────────────────────
    const surfacePos = new Float32Array(SURFACE_POINTS * 3);
    const surfaceAlpha = new Float32Array(SURFACE_POINTS);
    for (let i = 0; i < SURFACE_POINTS; i += 1) {
      const p = fibonacciPoint(i, SURFACE_POINTS).multiplyScalar(RADIUS);
      surfacePos[i * 3] = p.x;
      surfacePos[i * 3 + 1] = p.y;
      surfacePos[i * 3 + 2] = p.z;
      // A little variance so the cloud has texture rather than reading as a
      // perfectly uniform mesh, which looks manufactured.
      surfaceAlpha[i] = 0.25 + rand() * 0.75;
    }
    const surfaceGeo = new THREE.BufferGeometry();
    surfaceGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(surfacePos, 3),
    );
    surfaceGeo.setAttribute(
      "aSeed",
      new THREE.BufferAttribute(surfaceAlpha, 1),
    );
    disposables.push(surfaceGeo);

    const surfaceMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixel: { value: 1 } },
      vertexShader: `
        attribute float aSeed;
        uniform float uTime;
        uniform float uPixel;
        varying float vFade;
        varying float vSeed;
        varying float vLit;
        void main() {
          vSeed = aSeed;
          // Sun from upper-left-front. Points on the night side survive at a
          // fifth of their brightness, which is what city lights look like.
          vLit = 0.2 + 0.8 * smoothstep(-0.35, 0.55,
            dot(normalize(position), normalize(vec3(-0.55, 0.62, 0.56))));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Points on the far side of the sphere are still drawn (additive
          // blending has no depth sorting to rely on), so they are faded by
          // *facing* instead: +z in view space is toward the camera. This is
          // what gives the cloud its volume, and unlike a view-depth test it
          // does not silently break when the camera moves.
          vFade = smoothstep(-0.15, 0.72, normalize(normalMatrix * normalize(position)).z);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.5 + aSeed * 2.1) * uPixel;
        }
      `,
      fragmentShader: `
        varying float vFade;
        varying float vSeed;
        varying float vLit;
        uniform float uTime;
        void main() {
          // Round points. gl_PointCoord is the only way to get one, and
          // without it every "star" is a square.
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = dot(d, d);
          if (r > 0.25) discard;
          float core = 1.0 - smoothstep(0.0, 0.25, r);
          // A slow, per-point breath. Different phase per point, so the
          // surface shimmers rather than pulsing as one object.
          float breath = 0.72 + 0.28 * sin(uTime * 0.7 + vSeed * 34.0);
          float a = core * vFade * breath * (0.42 + vSeed * 0.58) * vLit;
          gl_FragColor = vec4(0.88, 0.88, 0.88, a);
        }
      `,
    });
    disposables.push(surfaceMat);
    world.add(new THREE.Points(surfaceGeo, surfaceMat));

    // ── 2. Atmosphere ─────────────────────────────────────────────────────
    const atmGeo = new THREE.SphereGeometry(RADIUS * 1.055, 96, 96);
    disposables.push(atmGeo);
    const atmMat = new THREE.ShaderMaterial({
      // Inside out. Seen from within, the shell is thickest exactly where the
      // sphere's edge is, which is the whole effect.
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        void main() {
          // The 0.62 offset pulls the glow off the silhouette so it reads as a
          // shell with height, not as an outline stroke.
          // Tighter exponent and a shallower offset: the light now lives in
          // the last few degrees before the silhouette instead of spreading
          // halfway across the disc.
          float i = pow(max(0.0, 0.88 - dot(vNormal, vec3(0.0, 0.0, 1.0))), 7.0);
          // Neutral, not blue. A real limb runs white through cyan into deep
          // blue, and this shader used to say so — but /landing/x carries no
          // hue anywhere else, and the hero was the first thing on the page
          // and the bluest. Bright core falling to a dark grey edge keeps the
          // shell reading as a shell; it is the same photograph in black and
          // white.
          vec3 hot = vec3(0.94, 0.94, 0.94);
          vec3 cold = vec3(0.34, 0.34, 0.36);
          gl_FragColor = vec4(mix(cold, hot, clamp(i * 2.2, 0.0, 1.0)), 1.0)
                       * clamp(i, 0.0, 1.0) * 0.72;
        }
      `,
    });
    disposables.push(atmMat);
    world.add(new THREE.Mesh(atmGeo, atmMat));

    // The body itself: opaque and near-black, so arcs and points behind the
    // sphere are occluded and the thing reads as solid rather than as a
    // transparent ball of dots.
    const bodyGeo = new THREE.SphereGeometry(RADIUS * 0.965, 48, 48);
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x070707 });
    disposables.push(bodyGeo, bodyMat);
    world.add(new THREE.Mesh(bodyGeo, bodyMat));

    // ── 3. Arcs ───────────────────────────────────────────────────────────
    /**
     * Each arc is a fixed curve; only the travelling head moves. Rebuilding
     * curve geometry every frame is the usual way this is written and it is
     * also the reason most globes like this drop frames.
     */
    const arcPositions = new Float32Array(ARC_COUNT * ARC_SEGMENTS * 3);
    const arcProgress = new Float32Array(ARC_COUNT * ARC_SEGMENTS);
    const arcIndex = new Float32Array(ARC_COUNT * ARC_SEGMENTS);
    const phases = new Float32Array(ARC_COUNT);

    for (let a = 0; a < ARC_COUNT; a += 1) {
      const from = fibonacciPoint(
        Math.floor(rand() * SURFACE_POINTS),
        SURFACE_POINTS,
      );
      const to = fibonacciPoint(
        Math.floor(rand() * SURFACE_POINTS),
        SURFACE_POINTS,
      );
      // Lift scales with separation: a hop between neighbours should stay low
      // and a hop across the world should go high, exactly like a flight path.
      const lift = 1 + 0.28 + from.distanceTo(to) * 0.34;
      const mid = from.clone().add(to).normalize().multiplyScalar(lift);
      const curve = new THREE.QuadraticBezierCurve3(
        from.clone().multiplyScalar(RADIUS),
        mid,
        to.clone().multiplyScalar(RADIUS),
      );
      phases[a] = rand();

      for (let s = 0; s < ARC_SEGMENTS; s += 1) {
        const t = s / (ARC_SEGMENTS - 1);
        const p = curve.getPoint(t);
        const i = a * ARC_SEGMENTS + s;
        arcPositions[i * 3] = p.x;
        arcPositions[i * 3 + 1] = p.y;
        arcPositions[i * 3 + 2] = p.z;
        arcProgress[i] = t;
        arcIndex[i] = a;
      }
    }

    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute("position", new THREE.BufferAttribute(arcPositions, 3));
    arcGeo.setAttribute("aT", new THREE.BufferAttribute(arcProgress, 1));
    arcGeo.setAttribute("aArc", new THREE.BufferAttribute(arcIndex, 1));
    disposables.push(arcGeo);

    const arcMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPixel: { value: 1 } },
      vertexShader: `
        attribute float aT;
        attribute float aArc;
        uniform float uTime;
        uniform float uPixel;
        varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          // The head's position along its own arc, cycling. Each arc gets its
          // own offset so they do not fire in unison.
          float head = fract(uTime * 0.14 + aArc * 0.37);
          // A comet: bright at the head, tailing off behind it, nothing ahead.
          float behind = head - aT;
          float tail = behind < 0.0 ? 0.0 : exp(-behind * 11.0);
          // Same correction as the surface: direction from the globe's centre
          // to this vertex, in view space, so an arc dims as it passes behind.
          vec3 centre = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          float depth = smoothstep(-0.5, 0.5, normalize(mv.xyz - centre).z);
          vA = tail * depth;
          gl_PointSize = (1.2 + tail * 3.4) * uPixel;
        }
      `,
      fragmentShader: `
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          if (dot(d, d) > 0.25) discard;
          if (vA < 0.004) discard;
          gl_FragColor = vec4(0.94, 0.94, 0.94, vA);
        }
      `,
    });
    disposables.push(arcMat);
    world.add(new THREE.Points(arcGeo, arcMat));

    // (The comet head is drawn by the arc shader itself — see `tail` above.
    // A separate PointsMaterial layer was tried for it and drew squares.)

    // ── 4. Stars ──────────────────────────────────────────────────────────
    const starPos = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i += 1) {
      // On a shell well outside the globe, so they never intersect it.
      const v = new THREE.Vector3(
        rand() * 2 - 1,
        rand() * 2 - 1,
        rand() * 2 - 1,
      )
        .normalize()
        .multiplyScalar(7 + rand() * 5);
      starPos[i * 3] = v.x;
      starPos[i * 3 + 1] = v.y;
      starPos[i * 3 + 2] = v.z;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xc9c9c9,
      size: 1.25,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    disposables.push(starGeo, starMat);
    scene.add(new THREE.Points(starGeo, starMat));

    // ── Loop ──────────────────────────────────────────────────────────────
    let frame = 0;
    let visible = false;
    const started = performance.now();

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const px = renderer.getPixelRatio();
      surfaceMat.uniforms.uPixel.value = px;
      arcMat.uniforms.uPixel.value = px;
    };

    const render = (t: number) => {
      surfaceMat.uniforms.uTime.value = t;
      arcMat.uniforms.uTime.value = t;
      renderer.render(scene, camera);
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      // An offscreen or backgrounded canvas costs nothing. `document.hidden`
      // is checked as well as visibility because a backgrounded tab throttles
      // rAF to ~1Hz and the elapsed delta arrives as a jump.
      if (!visible || document.hidden) return;
      const t = (performance.now() - started) / 1000;
      // Slow. A globe that spins fast reads as a loading spinner; this is one
      // revolution every ~2.5 minutes, which is felt rather than watched.
      world.rotation.y = t * 0.042;
      render(t);
    };

    resize();
    render(0);

    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { rootMargin: "120px" },
    );
    io.observe(host);

    if (!still) frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      // Without this the context survives the unmount and Chrome starts
      // evicting older ones after roughly sixteen.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={`pointer-events-none ${className ?? ""}`}
    />
  );
}
