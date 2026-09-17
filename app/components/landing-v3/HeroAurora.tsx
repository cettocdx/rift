"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * The hero's ground: a slow field of colour.
 *
 * This is the one thing procedural generation is genuinely better at than
 * assets. An earlier attempt built a whole photoreal world out of drawn
 * textures and never reached the quality it needed; a flow field is the
 * opposite case — it is pure mathematics, resolution-independent, sharp on a
 * 4K display, and it animates for free.
 *
 * The look is domain-warped fractal noise: noise used to distort the
 * coordinates of more noise, which is what produces those long folded bands
 * rather than the cloudy blobs plain fBm gives. Colour is sampled along the
 * vertical, so the field reads as a horizon — cool and misty at the top,
 * warming down through gold into deep ember at the base.
 *
 * Three details do most of the work, and all three are the difference between
 * this and a CSS gradient:
 *   - The bands are stretched horizontally, so the eye reads drift rather than
 *     turbulence.
 *   - Grain is added per pixel. Smooth gradients band badly on real displays;
 *     a little noise is what hides it.
 *   - It moves at roughly the speed of weather. Fast enough to be alive,
 *     slow enough that nobody watches it instead of reading.
 */

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;

  uniform float uTime;
  uniform vec2 uResolution;
  uniform vec2 uPointer;
  varying vec2 vUv;

  // --- noise ---------------------------------------------------------------
  vec2 hash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
  }

  float noise(vec2 p) {
    const float K1 = 0.366025404;
    const float K2 = 0.211324865;
    vec2 i = floor(p + (p.x + p.y) * K1);
    vec2 a = p - i + (i.x + i.y) * K2;
    float m = step(a.y, a.x);
    vec2 o = vec2(m, 1.0 - m);
    vec2 b = a - o + K2;
    vec2 c = a - 1.0 + 2.0 * K2;
    vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
    vec3 n = h * h * h * h * vec3(
      dot(a, hash(i)),
      dot(b, hash(i + o)),
      dot(c, hash(i + 1.0))
    );
    return dot(n, vec3(70.0));
  }

  float fbm(vec2 p) {
    float total = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 6; i++) {
      total += noise(p) * amplitude;
      p = p * 2.02 + vec2(3.1, 1.7);
      amplitude *= 0.5;
    }
    return total;
  }

  // Noise whose input has been displaced by more noise. This is what folds the
  // field into long bands instead of leaving it as clouds.
  float warped(vec2 p, out vec2 flow) {
    vec2 q = vec2(fbm(p), fbm(p + vec2(5.2, 1.3)));
    vec2 r = vec2(
      fbm(p + 4.0 * q + vec2(1.7, 9.2) + uTime * 0.021),
      fbm(p + 4.0 * q + vec2(8.3, 2.8) - uTime * 0.017)
    );
    flow = r;
    return fbm(p + 4.0 * r);
  }

  // --- palette -------------------------------------------------------------
  vec3 palette(float t) {
    // Sampled down the frame: misty blue-green at the top, through moss and
    // gold, into ember at the base.
    vec3 mist   = vec3(0.478, 0.596, 0.612);
    vec3 sage   = vec3(0.321, 0.435, 0.376);
    vec3 forest = vec3(0.180, 0.271, 0.216);
    vec3 moss   = vec3(0.400, 0.396, 0.220);
    vec3 gold   = vec3(0.741, 0.612, 0.278);
    vec3 amber  = vec3(0.706, 0.435, 0.157);
    vec3 ember  = vec3(0.431, 0.153, 0.078);

    vec3 c = mix(mist, sage, smoothstep(0.00, 0.20, t));
    c = mix(c, forest, smoothstep(0.16, 0.40, t));
    c = mix(c, moss,   smoothstep(0.38, 0.58, t));
    c = mix(c, gold,   smoothstep(0.55, 0.72, t));
    c = mix(c, amber,  smoothstep(0.70, 0.86, t));
    c = mix(c, ember,  smoothstep(0.84, 1.00, t));
    return c;
  }

  void main() {
    vec2 uv = vUv;
    float aspect = uResolution.x / max(uResolution.y, 1.0);

    // Stretched horizontally so the structure reads as drift, not turbulence.
    vec2 p = vec2(uv.x * aspect * 0.62, uv.y * 1.85);
    // The pointer leans the field rather than dragging it: a background that
    // follows the cursor exactly is a toy.
    p += uPointer * 0.06;

    vec2 flow;
    float n = warped(p, flow);

    // Bend the vertical sample by the field itself, so the colour bands follow
    // the folds instead of lying flat across them.
    float t = clamp(1.0 - uv.y + n * 0.26 + flow.y * 0.06, 0.0, 1.0);
    vec3 colour = palette(t);

    // A soft light where the fold crests, as if the sun were behind it.
    float crest = smoothstep(0.28, 0.72, n * 0.5 + 0.5);
    colour += vec3(0.28, 0.20, 0.10) * crest * 0.45;

    // Darken the corners so type has somewhere to sit.
    vec2 centred = uv - 0.5;
    float vignette = 1.0 - dot(centred, centred) * 0.62;
    colour *= vignette;

    // Per-pixel grain. Smooth gradients band on real displays; this hides it
    // and is most of why the result reads as photographic rather than as CSS.
    float grain = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    colour += (grain - 0.5) * 0.022;

    gl_FragColor = vec4(colour, 1.0);
  }
`;

export function HeroAurora({ className }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionQuery.matches;

    const scene = new THREE.Scene();
    // The shader writes clip space directly, so the camera is a formality.
    const camera = new THREE.Camera();

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, {
      display: "block",
      width: "100%",
      height: "100%",
    });

    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uPointer: { value: new THREE.Vector2(0, 0) },
    };
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    scene.add(new THREE.Mesh(geometry, material));

    const pointer = new THREE.Vector2(0, 0);
    const handlePointerMove = (event: PointerEvent) => {
      pointer.set(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1,
      );
    };
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });

    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      if (!clientWidth || !clientHeight) return;
      renderer.setSize(clientWidth, clientHeight, false);
      uniforms.uResolution.value.set(clientWidth, clientHeight);
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    let visible = true;
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0 },
    );
    intersectionObserver.observe(mount);

    const timer = new THREE.Timer();
    let elapsed = 0;

    const frame = () => {
      // A field nobody is looking at should not be costing anyone a GPU.
      if (!visible) return;

      timer.update();
      const delta = Math.min(timer.getDelta(), 0.1);

      if (!reduceMotion) {
        elapsed += delta;
        uniforms.uTime.value = elapsed;
        // Damped, so the field leans toward the reader instead of snapping.
        uniforms.uPointer.value.lerp(pointer, 1 - Math.exp(-delta * 1.6));
      }

      renderer.render(scene, camera);
    };

    renderer.setAnimationLoop(frame);

    const handleMotionChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
      // Render one frame so a reader who just switched it off still gets the
      // field rather than whatever was on screen when it stopped.
      if (reduceMotion) renderer.render(scene, camera);
    };
    motionQuery.addEventListener("change", handleMotionChange);

    return () => {
      renderer.setAnimationLoop(null);
      motionQuery.removeEventListener("change", handleMotionChange);
      window.removeEventListener("pointermove", handlePointerMove);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return <div ref={mountRef} aria-hidden className={className} />;
}
