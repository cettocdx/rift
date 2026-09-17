"use client";

import { Anthropic, Moonshot, OpenAI, Qwen, XAI, ZAI } from "@lobehub/icons";
import { useEffect, useRef, useState, type ComponentType } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SVGLoader } from "three/addons/loaders/SVGLoader.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

/**
 * Every model, wired to one mark.
 *
 * A row of logos states that the models are supported. This shows what the row
 * cannot: that they all terminate in the same place. Six stations hold orbit
 * around the RIFT mark and stream into it — the piece is about connection, not
 * decoration.
 *
 * The mark is the real brand geometry, not an approximation: the shipped SVG is
 * parsed at runtime and extruded with a bevel, so the object in the middle is
 * the same shape as the one in the navigation, given depth and a machined
 * surface. Redrawing it by hand would have been quicker and would have put a
 * second, slightly wrong logo into the product.
 *
 * It sits on the page rather than in a panel: transparent canvas, full width,
 * edges feathered into the ground beneath it.
 */

type Vendor = {
  name: string;
  Logo: ComponentType<{ size?: number; className?: string }>;
};

const VENDORS: Vendor[] = [
  { name: "OpenAI", Logo: OpenAI },
  { name: "Anthropic", Logo: Anthropic },
  { name: "xAI", Logo: XAI },
  { name: "Moonshot AI", Logo: Moonshot },
  { name: "Alibaba", Logo: Qwen },
  { name: "Z.ai", Logo: ZAI },
];

const ACCENT = new THREE.Color("#d98330");
const ORBIT_RADIUS = 5.6;
/** Packets in flight per downlink. Enough to read as a stream, not a queue. */
const PACKETS_PER_LINK = 6;

type LabelPosition = { x: number; y: number; scale: number; visible: boolean };

export function ModelConstellation() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<LabelPosition[]>(() =>
    VENDORS.map(() => ({ x: 0, y: 0, scale: 1, visible: false })),
  );

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;

    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    let reduceMotion = motionQuery.matches;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    camera.position.set(0, 2.6, 15);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    mount.appendChild(renderer.domElement);
    Object.assign(renderer.domElement.style, {
      display: "block",
      width: "100%",
      height: "100%",
    });

    // An alpha render target, so the composer carries transparency through
    // instead of handing back an opaque rectangle sitting on the page.
    const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      samples: 4,
    });
    const composer = new EffectComposer(renderer, renderTarget);
    const renderPass = new RenderPass(scene, camera);
    renderPass.clearAlpha = 0;
    composer.addPass(renderPass);
    // High threshold on purpose: bloom should find the emissive packets and the
    // rim of the mark, not turn brushed metal into chrome.
    composer.addPass(
      new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.7, 0.82),
    );
    composer.addPass(new OutputPass());

    const disposables: Array<{ dispose: () => void }> = [];
    disposables.push(renderTarget);

    // Metal is a mirror; with nothing to reflect it renders flat grey no matter
    // how many lights are aimed at it.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.7;
    pmrem.dispose();
    disposables.push(environment.texture);

    const key = new THREE.DirectionalLight(0xffffff, 3.0);
    key.position.set(-7, 8, 9);
    scene.add(key);
    const rim = new THREE.DirectionalLight(ACCENT, 4.2);
    rim.position.set(8, 1, -9);
    scene.add(rim);
    scene.add(new THREE.AmbientLight(0x39445a, 0.6));

    const markMaterial = new THREE.MeshStandardMaterial({
      color: 0xdfe6ee,
      metalness: 1,
      roughness: 0.22,
      envMapIntensity: 1.25,
    });
    const signalMaterial = new THREE.MeshStandardMaterial({
      color: 0x0d1014,
      emissive: ACCENT,
      emissiveIntensity: 3.0,
      roughness: 0.4,
    });
    const stationMaterial = new THREE.MeshStandardMaterial({
      color: 0xa8b2be,
      metalness: 1,
      roughness: 0.36,
      envMapIntensity: 0.95,
    });
    disposables.push(markMaterial, signalMaterial, stationMaterial);

    // --- the mark ------------------------------------------------------------
    const mark = new THREE.Group();
    scene.add(mark);

    // Parsed from the shipped asset rather than redrawn: the object in the
    // middle of this section is the same geometry as the one in the nav.
    new SVGLoader().load("/rift-icon-mono.svg", (data) => {
      if (disposed) return;
      const shapes = data.paths.flatMap((path) => SVGLoader.createShapes(path));
      const geometry = new THREE.ExtrudeGeometry(shapes, {
        depth: 14,
        bevelEnabled: true,
        bevelThickness: 2.2,
        bevelSize: 1.8,
        bevelSegments: 4,
        curveSegments: 12,
      });
      // SVG is y-down and origin-corner; three is y-up and origin-centre.
      geometry.scale(1, -1, 1);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!;
      const size = new THREE.Vector3();
      box.getSize(size);
      const centre = new THREE.Vector3();
      box.getCenter(centre);
      geometry.translate(-centre.x, -centre.y, -centre.z);
      // Normalise to a known height so the composition does not depend on the
      // asset's internal units.
      geometry.scale(
        ...(Array(3).fill(3.6 / size.y) as [number, number, number]),
      );
      geometry.computeVertexNormals();

      const solid = new THREE.Mesh(geometry, markMaterial);
      mark.add(solid);
      disposables.push(geometry);
    });

    // A cage around the mark, so the middle of the frame has depth before the
    // logo has even loaded and structure behind it after.
    const cageGeometry = new THREE.TorusGeometry(3.1, 0.022, 8, 140);
    const cageMaterial = new THREE.MeshStandardMaterial({
      color: 0x8b96a4,
      metalness: 1,
      roughness: 0.3,
      envMapIntensity: 1.1,
      transparent: true,
      opacity: 0.55,
    });
    const cages = [0, 1].map((i) => {
      const cage = new THREE.Mesh(cageGeometry, cageMaterial);
      cage.rotation.set(1.2 + i * 0.5, i * 0.9, i * 0.6);
      scene.add(cage);
      return cage;
    });
    disposables.push(cageGeometry, cageMaterial);

    // --- orbit ---------------------------------------------------------------
    const orbit = new THREE.Group();
    orbit.rotation.x = 0.46;
    scene.add(orbit);

    const orbitGeometry = new THREE.TorusGeometry(ORBIT_RADIUS, 0.007, 6, 180);
    const orbitMaterial = new THREE.MeshBasicMaterial({
      color: 0x4a6ba6,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orbitLine = new THREE.Mesh(orbitGeometry, orbitMaterial);
    orbitLine.rotation.x = Math.PI / 2;
    orbit.add(orbitLine);
    disposables.push(orbitGeometry, orbitMaterial);

    const bodyGeometry = new THREE.CylinderGeometry(0.16, 0.2, 0.36, 18);
    const panelGeometry = new THREE.BoxGeometry(0.74, 0.018, 0.26);
    const lampGeometry = new THREE.SphereGeometry(0.06, 12, 10);
    disposables.push(bodyGeometry, panelGeometry, lampGeometry);

    const stations = VENDORS.map((_, index) => {
      const station = new THREE.Group();
      const body = new THREE.Mesh(bodyGeometry, stationMaterial);
      body.rotation.z = Math.PI / 2;
      const left = new THREE.Mesh(panelGeometry, stationMaterial);
      left.position.x = -0.52;
      const right = new THREE.Mesh(panelGeometry, stationMaterial);
      right.position.x = 0.52;
      const lamp = new THREE.Mesh(lampGeometry, signalMaterial);
      lamp.position.y = 0.2;
      station.add(body, left, right, lamp);
      station.userData.phase = index / VENDORS.length;
      orbit.add(station);
      return station;
    });
    const anchors = stations.map(() => new THREE.Vector3());

    // --- downlinks -----------------------------------------------------------
    const packetCount = stations.length * PACKETS_PER_LINK;
    const packetGeometry = new THREE.OctahedronGeometry(0.05, 0);
    const packets = new THREE.InstancedMesh(
      packetGeometry,
      signalMaterial,
      packetCount,
    );
    // Instancing does not update a mesh's bounds; without this the traffic is
    // culled as soon as it leaves the origin cell.
    packets.frustumCulled = false;
    scene.add(packets);
    disposables.push(packetGeometry);

    const packetOffsets = new Float32Array(packetCount);
    for (let i = 0; i < packetCount; i += 1) {
      // Irregular spacing: evenly spaced packets read as a conveyor rather
      // than as traffic.
      packetOffsets[i] =
        ((i % PACKETS_PER_LINK) / PACKETS_PER_LINK +
          ((i * 37) % 100) / 620 +
          Math.floor(i / PACKETS_PER_LINK) * 0.17) %
        1;
    }

    // --- resize / visibility -------------------------------------------------
    const resize = () => {
      const { clientWidth, clientHeight } = mount;
      if (!clientWidth || !clientHeight) return;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight, false);
      composer.setSize(clientWidth, clientHeight);
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

    // --- loop ----------------------------------------------------------------
    const timer = new THREE.Timer();
    let elapsed = reduceMotion ? 3 : 0;
    const dummy = new THREE.Object3D();
    const worldAnchor = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const packetPosition = new THREE.Vector3();
    const towardCentre = new THREE.Vector3();
    let labelFrame = 0;

    const frame = () => {
      // A scene nobody is looking at should not be costing anyone a GPU.
      if (!visible) return;

      timer.update();
      const delta = Math.min(timer.getDelta(), 0.1);
      if (!reduceMotion) elapsed += delta;

      if (!reduceMotion) {
        mark.rotation.y = Math.sin(elapsed * 0.22) * 0.5;
        mark.rotation.x = Math.sin(elapsed * 0.17) * 0.09;
        mark.position.y = Math.sin(elapsed * 0.5) * 0.08;
        for (let i = 0; i < cages.length; i += 1) {
          cages[i].rotation.z += delta * (0.06 + i * 0.04);
          cages[i].rotation.y += delta * (0.04 + i * 0.03);
        }
      }

      for (let i = 0; i < stations.length; i += 1) {
        const angle = stations[i].userData.phase * Math.PI * 2 + elapsed * 0.08;
        stations[i].position.set(
          Math.cos(angle) * ORBIT_RADIUS,
          0,
          Math.sin(angle) * ORBIT_RADIUS,
        );
        stations[i].rotation.y = -angle;
        stations[i].getWorldPosition(worldAnchor);
        anchors[i].copy(worldAnchor);
      }

      // Packets fall from each station into the mark.
      for (let i = 0; i < packetCount; i += 1) {
        const linkIndex = Math.floor(i / PACKETS_PER_LINK);
        const t = (packetOffsets[i] + elapsed * 0.26) % 1;
        towardCentre.copy(anchors[linkIndex]).multiplyScalar(1 - t);
        packetPosition.copy(towardCentre);
        // A slight arc, so the traffic curves in rather than falling on a
        // straight line — the difference between a stream and a spoke diagram.
        packetPosition.y += Math.sin(t * Math.PI) * 0.55;
        dummy.position.copy(packetPosition);
        dummy.scale.setScalar(0.55 + (1 - t) * 0.85);
        dummy.rotation.set(elapsed * 2 + i, elapsed * 1.5 + i, 0);
        dummy.updateMatrix();
        packets.setMatrixAt(i, dummy.matrix);
      }
      packets.instanceMatrix.needsUpdate = true;

      composer.render();

      // Logo positions, projected from the stations. Throttled: they move
      // slowly and the DOM write is the expensive part of this component.
      labelFrame += 1;
      if (labelFrame % 3 === 0) {
        const { clientWidth, clientHeight } = mount;
        setLabels(
          anchors.map((anchor) => {
            projected.copy(anchor).project(camera);
            return {
              x: (projected.x * 0.5 + 0.5) * clientWidth,
              y: (-projected.y * 0.5 + 0.5) * clientHeight,
              scale: THREE.MathUtils.clamp(1.3 - projected.z * 0.4, 0.8, 1.1),
              visible: projected.z < 1,
            };
          }),
        );
      }
    };

    renderer.setAnimationLoop(frame);

    const handleMotionChange = (event: MediaQueryListEvent) => {
      reduceMotion = event.matches;
    };
    motionQuery.addEventListener("change", handleMotionChange);

    return () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      motionQuery.removeEventListener("change", handleMotionChange);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      composer.dispose();
      for (const item of disposables) item.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    // Part of the section, not a panel in it: full width, transparent, and
    // feathered at the edges so it sits on the page's own ground.
    <div className="relative mt-16 h-[clamp(400px,46vw,680px)] w-full">
      <div
        ref={mountRef}
        aria-hidden
        className="absolute inset-0 [mask-image:radial-gradient(130%_120%_at_50%_48%,#000_48%,transparent_84%)]"
      />

      {/* The marks stay HTML: crisp at any zoom, and other companies'
          trademarks should not be resampled into a texture. */}
      {VENDORS.map((vendor, index) => {
        const label = labels[index];
        return (
          <div
            key={vendor.name}
            className="pointer-events-none absolute left-0 top-0 flex flex-col items-center gap-1.5"
            style={{
              transform: `translate(${label.x}px, ${label.y}px) translate(-50%, -165%) scale(${label.scale})`,
              opacity: label.visible ? 1 : 0,
              transition: "opacity 240ms linear",
            }}
          >
            <vendor.Logo size={20} className="text-foreground" />
            <span className="whitespace-nowrap text-[11px] font-medium tracking-[-0.005em] text-[var(--cursor-text-secondary)]">
              {vendor.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
