"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * The RIFT machine — a brushed-metal computer, the way Factory renders its
 * droid computer: a machined aluminium case on a light platform, a green power
 * light, and a live readout on its face. Not a sculpture; a box you can watch
 * work.
 *
 * The metal is brushed rather than mirror: a canvas of fine vertical streaks
 * drives both the colour map and the roughness, so the case reads as anodised
 * aluminium catching a studio softbox rather than as chrome. A green power
 * light glows on the front with its own point light; the stats on the face are
 * an HTML overlay (see HTelemetry) so they can tick.
 *
 * Cost is bounded the way every animated surface here is: one rAF gated by an
 * IntersectionObserver and `document.hidden`, DPR capped, ACES tone mapping,
 * full disposal including the env map and PMREM generator. Reduced motion
 * renders a single still frame.
 */
export function HMachine({ className }: { className?: string }) {
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
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(2.6, 2.5, 6.2);
    camera.lookAt(0, -0.1, 0);

    const disposables: { dispose: () => void }[] = [];

    // ── Studio environment ─────────────────────────────────────────────────
    const envCanvas = document.createElement("canvas");
    envCanvas.width = 1024;
    envCanvas.height = 512;
    const ectx = envCanvas.getContext("2d");
    if (ectx) {
      const g = ectx.createLinearGradient(0, 0, 0, 512);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.5, "#eceef1");
      g.addColorStop(1, "#c4c8cd");
      ectx.fillStyle = g;
      ectx.fillRect(0, 0, 1024, 512);
      ectx.fillStyle = "rgba(255,255,255,0.9)";
      ectx.fillRect(180, 60, 320, 90);
      ectx.fillRect(620, 90, 240, 70);
    }
    const envTex = new THREE.CanvasTexture(envCanvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromEquirectangular(envTex);
    scene.environment = envRT.texture;
    envTex.dispose();
    disposables.push(envRT, pmrem);

    // ── Brushed-aluminium texture ──────────────────────────────────────────
    const brushCanvas = document.createElement("canvas");
    brushCanvas.width = 512;
    brushCanvas.height = 512;
    const bctx = brushCanvas.getContext("2d");
    if (bctx) {
      bctx.fillStyle = "#7a808a";
      bctx.fillRect(0, 0, 512, 512);
      for (let x = 0; x < 512; x += 1) {
        const n = (Math.sin(x * 12.9898) * 43758.5453) % 1;
        const shade = 88 + Math.floor(Math.abs(n) * 44);
        bctx.strokeStyle = `rgba(${shade},${shade + 4},${shade + 10},0.3)`;
        bctx.beginPath();
        bctx.moveTo(x + 0.5, 0);
        bctx.lineTo(x + 0.5, 512);
        bctx.stroke();
      }
    }
    const brushTex = new THREE.CanvasTexture(brushCanvas);
    brushTex.colorSpace = THREE.SRGBColorSpace;
    brushTex.wrapS = brushTex.wrapT = THREE.RepeatWrapping;
    const roughTex = new THREE.CanvasTexture(brushCanvas);
    roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping;
    disposables.push(brushTex, roughTex);

    const alu = new THREE.MeshStandardMaterial({
      map: brushTex,
      roughnessMap: roughTex,
      color: 0x828892,
      metalness: 0.88,
      roughness: 0.5,
      envMapIntensity: 1.0,
    });
    disposables.push(alu);

    // ── The case ───────────────────────────────────────────────────────────
    const machine = new THREE.Group();
    scene.add(machine);

    const caseGeo = new RoundedBoxGeometry(2.5, 2.85, 2.5, 6, 0.09);
    disposables.push(caseGeo);
    const box = new THREE.Mesh(caseGeo, alu);
    machine.add(box);

    // A darker recessed seam across the front.
    const seamGeo = new THREE.BoxGeometry(2.52, 0.02, 2.52);
    const seamMat = new THREE.MeshStandardMaterial({
      color: 0x2a2d31,
      metalness: 0.6,
      roughness: 0.7,
    });
    disposables.push(seamGeo, seamMat);
    const seam = new THREE.Mesh(seamGeo, seamMat);
    seam.position.y = 0.55;
    machine.add(seam);

    // ── Green power light ──────────────────────────────────────────────────
    const ringGeo = new THREE.TorusGeometry(0.16, 0.03, 24, 48);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x30343a,
      metalness: 0.9,
      roughness: 0.4,
    });
    disposables.push(ringGeo, ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(0.72, 0.86, 1.262);
    machine.add(ring);

    const ledGeo = new THREE.CircleGeometry(0.14, 40);
    const ledMat = new THREE.MeshStandardMaterial({
      color: 0x8fe6a6,
      emissive: 0x39c96a,
      emissiveIntensity: 1.4,
      metalness: 0,
      roughness: 0.4,
    });
    disposables.push(ledGeo, ledMat);
    const led = new THREE.Mesh(ledGeo, ledMat);
    led.position.set(0.72, 0.86, 1.255);
    machine.add(led);

    const ledLight = new THREE.PointLight(0x4fe07a, 2.0, 3.2, 2);
    ledLight.position.set(0.72, 0.86, 1.5);
    machine.add(ledLight);

    // ── Platform + soft contact shadow ─────────────────────────────────────
    const platGeo = new THREE.CylinderGeometry(4.2, 4.2, 0.2, 64);
    const platMat = new THREE.MeshStandardMaterial({
      color: 0xe9e9e7,
      metalness: 0.1,
      roughness: 0.85,
    });
    disposables.push(platGeo, platMat);
    const platform = new THREE.Mesh(platGeo, platMat);
    platform.position.y = -1.52;
    scene.add(platform);

    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 256;
    const sctx = shadowCanvas.getContext("2d");
    if (sctx) {
      const rg = sctx.createRadialGradient(128, 128, 10, 128, 128, 128);
      rg.addColorStop(0, "rgba(20,20,24,0.5)");
      rg.addColorStop(1, "rgba(20,20,24,0)");
      sctx.fillStyle = rg;
      sctx.fillRect(0, 0, 256, 256);
    }
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    const shadowGeo = new THREE.PlaneGeometry(4.4, 4.4);
    disposables.push(shadowTex, shadowMat, shadowGeo);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -1.41;
    scene.add(shadow);

    // ── Lights ─────────────────────────────────────────────────────────────
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb6bac0, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(5, 7, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xd6def0, 0.6);
    fill.position.set(-6, 3, 2);
    scene.add(fill);

    // ── Loop ───────────────────────────────────────────────────────────────
    let frame = 0;
    let visible = false;
    const start = performance.now();

    const resize = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    const render = (t: number) => {
      machine.rotation.y = -0.5 + Math.sin(t * 0.16) * 0.28;
      machine.position.y = Math.sin(t * 0.6) * 0.04;
      const pulse = 1.1 + Math.sin(t * 2.2) * 0.4;
      ledMat.emissiveIntensity = pulse;
      ledLight.intensity = 1.4 + pulse * 0.5;
      renderer.render(scene, camera);
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!visible || document.hidden) return;
      render((performance.now() - start) / 1000);
    };

    resize();
    render(0);

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { rootMargin: "160px" },
    );
    io.observe(host);

    if (!still) frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      for (const d of disposables) d.dispose();
      renderer.dispose();
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
