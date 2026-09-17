"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { RIFT_SYMBOL_PATH } from "@/lib/brand/logo";
import styles from "./prime.module.css";

/** The approved emblem, modelled in metal. No remote models or textures. */
export default function PrimeSculpture({ paused }: { paused: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const pauseRef = useRef(paused);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    pauseRef.current = paused;
  }, [paused]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    async function init() {
      const [THREE, { SVGLoader }, { RoomEnvironment }] = await Promise.all([
        import("three"),
        import("three/addons/loaders/SVGLoader.js"),
        import("three/addons/environments/RoomEnvironment.js"),
      ]);
      if (disposed || !el) return;
      const renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
      renderer.setClearColor(0x191919, 0);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      camera.position.set(0, 0, 10.7);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      const env = pmrem.fromScene(room, 0.025);
      scene.environment = env.texture;
      const group = new THREE.Group();
      scene.add(group);
      const metal = new THREE.MeshPhysicalMaterial({
        color: 0xbec1b8,
        side: THREE.DoubleSide,
        metalness: 1,
        roughness: 0.24,
        clearcoat: 0.65,
        clearcoatRoughness: 0.24,
        envMapIntensity: 1.4,
      });
      const yellow = new THREE.MeshPhysicalMaterial({
        color: 0xe6f847,
        side: THREE.DoubleSide,
        metalness: 0.5,
        roughness: 0.26,
        emissive: 0xc6d335,
        emissiveIntensity: 0.12,
      });
      const svg = new SVGLoader().parse(
        `<svg xmlns="http://www.w3.org/2000/svg"><path d="${RIFT_SYMBOL_PATH}"/></svg>`,
      );
      const shape = svg.paths[0].toShapes()[0];
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: 12,
        bevelEnabled: true,
        bevelSegments: 6,
        steps: 1,
        bevelSize: 1.7,
        bevelThickness: 1.7,
        curveSegments: 48,
      });
      geometry.translate(-50, -50, -6);
      geometry.scale(0.052, -0.052, 0.052);
      const positions = geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i),
          y = positions.getY(i);
        positions.setZ(
          i,
          positions.getZ(i) +
            Math.sin(x * 0.85) * 0.32 +
            Math.cos(y * 0.7) * 0.22,
        );
      }
      geometry.computeVertexNormals();
      const top = new THREE.Mesh(geometry, metal);
      const bottom = new THREE.Mesh(geometry, metal);
      bottom.rotation.z = Math.PI;
      group.add(top, bottom);
      // A thin yellow inlay remains physically part of the emblem.
      const inlay = new THREE.Mesh(geometry, yellow);
      inlay.scale.set(1.006, 1.006, 0.075);
      inlay.position.z = -0.32;
      const inlay2 = inlay.clone();
      inlay2.rotation.z = Math.PI;
      group.add(inlay, inlay2);
      const key = new THREE.DirectionalLight(0xffffff, 4);
      key.position.set(-3, 5, 6);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, 2.5);
      rim.position.set(4, -2, -1);
      scene.add(rim);
      const fill = new THREE.DirectionalLight(0xd9e8f3, 2);
      fill.position.set(-4, -3, 2);
      scene.add(fill);
      let visible = true;
      let mx = 0,
        my = 0,
        rx = 0,
        ry = 0,
        clock = 0,
        previous = 0;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
      let needsRender = true;
      const resize = () => {
        needsRender = true;
        const { width, height } = el.getBoundingClientRect();
        renderer.setSize(width, height);
        camera.aspect = width / Math.max(height, 1);
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(el);
      resize();
      const io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
      });
      io.observe(el);
      const move = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        const box = el.getBoundingClientRect();
        mx = (event.clientX - box.left) / box.width - 0.5;
        my = (event.clientY - box.top) / box.height - 0.5;
      };
      const leave = () => {
        mx = 0;
        my = 0;
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
      let first = true;
      renderer.setAnimationLoop((time) => {
        const dt = Math.min((time - previous) / 1000, 0.04);
        previous = time;
        if (!first && (!visible || document.hidden)) return;
        const moving = !pauseRef.current && !reduce.matches;
        if (!first && !moving && !needsRender) return;
        if (moving) clock += dt;
        rx += ((moving ? my : 0) - rx) * 0.055;
        ry += ((moving ? mx : 0) - ry) * 0.055;
        group.rotation.set(
          0.15 + rx * 0.25,
          -0.48 + ry * 0.42 + Math.sin(clock * 0.28) * 0.09,
          -0.28,
        );
        group.position.y = Math.sin(clock * 0.55) * 0.09;
        top.position.y = 0.04;
        bottom.position.y = -0.04;
        renderer.render(scene, camera);
        needsRender = false;
        if (first) {
          first = false;
          setReady(true);
        }
      });
      cleanup = () => {
        renderer.setAnimationLoop(null);
        ro.disconnect();
        io.disconnect();
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
        geometry.dispose();
        metal.dispose();
        yellow.dispose();
        env.dispose();
        room.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    }
    init().catch((error) => {
      console.warn("RIFT sculpture unavailable", error);
      /* The approved static emblem remains visible. */
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, []);
  return (
    <div className={styles.sculpture} aria-hidden="true">
      <div
        className={`${styles.sculptureFallback} ${ready ? styles.fallbackHidden : ""}`}
      >
        <Image
          src="/brand/Rift-Symbol-White.svg"
          alt=""
          width="560"
          height="560"
        />
      </div>
      <div
        ref={host}
        className={`${styles.canvasHost} ${ready ? styles.canvasReady : ""}`}
      />
    </div>
  );
}
