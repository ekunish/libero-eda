"use client";

import { OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Box, Camera, Expand, Focus, RefreshCw } from "lucide-react";
import {
  Component,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import type { EvaluationSceneRecord } from "@/shared/api";
import { Button, IconButton, Skeleton } from "@/shared/ui/primitives";
import { fixedCameraPoseFromCalibration } from "../model/camera-pose";
import {
  createMujocoCubeTexture,
  createMujocoPhongMaterial,
  type MujocoRenderContract,
  mujocoCubeScale,
} from "../model/mujoco-render";
import {
  createTaskCueMaterialBindings,
  type TaskCueMaterial,
  taskCuePulsePhase,
  updateTaskCueMaterial,
} from "../model/task-cue-appearance";
import type { TaskCueBody } from "../model/task-cues";
import { useReducedMotion } from "../model/use-reduced-motion";
import { addPlanarReflector, MujocoLights } from "./replay-workbench";

type CameraMode = "front" | "oblique";

function textureUrl(base: string, key: string): string {
  return new URL(`${key.slice(0, 2)}/${key}.png`, base).toString();
}

function evaluationTextureUrls(record: EvaluationSceneRecord): string[] {
  const keys = new Set<string>();
  for (const material of Object.values(record.snapshot.materials)) {
    if (material.texture_key) keys.add(material.texture_key);
  }
  const skyboxKey = record.snapshot.render.skybox?.texture_key;
  if (skyboxKey) keys.add(skyboxKey);
  return [...keys].sort().map((key) => textureUrl(record.texture_base_asset_id, key));
}

function EvaluationSkybox({ texture }: { texture: THREE.Texture | null }) {
  const getThree = useThree((state) => state.get);
  useEffect(() => {
    const root = getThree().scene;
    if (!texture) {
      root.background = null;
      return;
    }
    const cube = createMujocoCubeTexture(texture);
    root.background = cube;
    root.backgroundRotation.set(Math.PI / 2, 0, 0);
    return () => {
      if (root.background === cube) root.background = null;
      cube.dispose();
    };
  }, [getThree, texture]);
  return null;
}

function EvaluationDigitalTwin({
  record,
  taskCueBodies,
  taskCuesEnabled,
  reducedMotion,
  onReady,
}: {
  record: EvaluationSceneRecord;
  taskCueBodies: TaskCueBody[];
  taskCuesEnabled: boolean;
  reducedMotion: boolean;
  onReady: () => void;
}) {
  const gltf = useGLTF(record.geometry_pack_asset_id) as { scene: THREE.Group };
  const skybox = record.snapshot.render.skybox;
  const textureKeys = useMemo(() => {
    const values = new Set<string>();
    for (const material of Object.values(record.snapshot.materials)) {
      if (material.texture_key) values.add(material.texture_key);
    }
    if (skybox?.texture_key) values.add(skybox.texture_key);
    return [...values].sort();
  }, [record.snapshot.materials, skybox]);
  const textureUrls = useMemo(() => evaluationTextureUrls(record), [record]);
  const loadedTextures = useLoader(THREE.TextureLoader, textureUrls) as THREE.Texture[];
  const textures = useMemo(
    () => new Map(textureKeys.map((key, index) => [key, loadedTextures[index] as THREE.Texture])),
    [loadedTextures, textureKeys],
  );
  const lightRender = useMemo<MujocoRenderContract>(
    () => ({ ...record.snapshot.render, skybox: null }),
    [record.snapshot.render],
  );
  const cueRoles = useMemo(
    () => new Map(taskCueBodies.map((body) => [body.bodyName, new Set(body.roles)])),
    [taskCueBodies],
  );
  const scene = useMemo(() => {
    const geometryByKey = new Map<string, THREE.BufferGeometry>();
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh && /^[0-9a-f]{64}$/.test(object.name)) {
        if (geometryByKey.has(object.name)) {
          throw new Error(`Evaluation geometry is duplicated: ${object.name}`);
        }
        geometryByKey.set(object.name, object.geometry);
      }
    });
    const root = new THREE.Group();
    root.name = `Evaluation initial scene: ${record.condition.task_key}`;
    const bodyByName = new Map<string, THREE.Group>();
    const cueMaterials: TaskCueMaterial[] = [];
    const cubeByTexture = new Map<string, THREE.CubeTexture>();
    const convertedMaterials = new Set<THREE.MeshPhongMaterial>();
    const shadows = lightRender.lights.some((light) => light.active && light.cast_shadow);
    for (const body of record.snapshot.bodies) {
      const group = new THREE.Group();
      group.name = body.name;
      group.position.fromArray(body.translation);
      group.quaternion.fromArray(body.rotation);
      group.userData.mujocoBodyName = body.name;
      bodyByName.set(body.name, group);
      root.add(group);
    }
    for (const geom of record.snapshot.geoms) {
      const body = bodyByName.get(geom.body);
      const geometry = geometryByKey.get(geom.geometry_key);
      const classic = record.snapshot.materials[geom.material_key];
      if (!body || !geometry || !classic) {
        throw new Error(`Evaluation scene reference is missing: ${geom.name}`);
      }
      const source = new THREE.MeshBasicMaterial({
        name: geom.material_key,
        map: classic.texture_key ? (textures.get(classic.texture_key) ?? null) : null,
      });
      source.userData.mujocoMaterial = structuredClone(classic);
      let cubeMapping: { texture: THREE.CubeTexture; scale: THREE.Vector3 } | undefined;
      if (classic.texture_type === 1) {
        if (!classic.texture_key) {
          throw new Error(`Evaluation cube texture is missing: ${geom.name}`);
        }
        let cube = cubeByTexture.get(classic.texture_key);
        if (!cube) {
          const texture = textures.get(classic.texture_key);
          if (!texture)
            throw new Error(`Evaluation texture was not loaded: ${classic.texture_key}`);
          cube = createMujocoCubeTexture(texture);
          cubeByTexture.set(classic.texture_key, cube);
        }
        cubeMapping = {
          texture: cube,
          scale: mujocoCubeScale(geom.geom_type, geom.geom_size, classic.texuniform),
        };
      }
      const material = createMujocoPhongMaterial(source, classic, lightRender, cubeMapping);
      source.dispose();
      convertedMaterials.add(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = geom.name;
      mesh.position.fromArray(geom.translation);
      mesh.quaternion.fromArray(geom.rotation);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      mesh.userData.mujocoBodyName = geom.body;
      mesh.userData.mujocoGeomType = geom.geom_type;
      mesh.userData.mujocoGeomSize = geom.geom_size;
      mesh.userData.mujocoReflectiveSurface = geom.reflective_surface ?? undefined;
      addPlanarReflector(mesh);
      const roles = cueRoles.get(geom.body);
      if (roles?.size) {
        cueMaterials.push(...createTaskCueMaterialBindings([material], roles));
      }
      body.add(mesh);
    }
    root.updateMatrixWorld(true);
    root.userData.cueMaterials = cueMaterials;
    root.userData.cubeTextures = cubeByTexture;
    root.userData.convertedMaterials = convertedMaterials;
    return root;
  }, [cueRoles, gltf.scene, lightRender, record, textures]);
  useFrame(({ clock }) => {
    const phase = taskCuePulsePhase(clock.getElapsedTime(), reducedMotion);
    for (const binding of (scene.userData.cueMaterials as TaskCueMaterial[]) ?? []) {
      updateTaskCueMaterial(binding, taskCuesEnabled, phase);
    }
  });
  useEffect(() => {
    onReady();
  }, [onReady]);
  useEffect(
    () => () => {
      scene.traverse((object) => {
        if (object instanceof Reflector) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
          object.getRenderTarget().dispose();
          if (object.userData.parcOwnsGeometry) object.geometry.dispose();
        }
      });
      for (const material of scene.userData.convertedMaterials as Set<THREE.Material>) {
        material.dispose();
      }
      for (const texture of (
        scene.userData.cubeTextures as Map<string, THREE.CubeTexture>
      ).values()) {
        texture.dispose();
      }
    },
    [scene],
  );
  const skyboxKey = record.snapshot.render.skybox?.texture_key;
  return (
    <>
      <MujocoLights render={lightRender} />
      <EvaluationSkybox texture={skyboxKey ? (textures.get(skyboxKey) ?? null) : null} />
      <primitive object={scene} />
    </>
  );
}

class EvaluationSceneErrorBoundary extends Component<
  { children: ReactNode; onError: (error: Error) => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onError(error instanceof Error ? error : new Error(String(error)));
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function CameraRig({
  mode,
  reset,
  record,
}: {
  mode: CameraMode;
  reset: number;
  record: EvaluationSceneRecord;
}) {
  const bounds = useMemo(() => {
    const points = record.snapshot.bodies.map((body) =>
      new THREE.Vector3().fromArray(body.translation),
    );
    return new THREE.Box3().setFromPoints(points);
  }, [record.snapshot.bodies]);
  const center = bounds.getCenter(new THREE.Vector3());
  const span = Math.max(1.2, bounds.getSize(new THREE.Vector3()).length() * 0.42);
  const front = record.snapshot.cameras.find(
    (camera) => camera.camera === "agentview" && camera.scope === "fixed_world",
  );
  const pose =
    mode === "front" && front
      ? fixedCameraPoseFromCalibration(front)
      : {
          position: [center.x + span, center.y - span * 1.25, center.z + span * 0.8] as [
            number,
            number,
            number,
          ],
          quaternion: undefined,
          target: center.toArray(),
          up: [0, 0, 1] as [number, number, number],
          fov: 43,
        };
  const key = `${record.condition.task_key}-${mode}-${reset}`;
  return (
    <>
      <PerspectiveCamera
        key={`camera-${key}`}
        makeDefault
        position={pose.position}
        quaternion={pose.quaternion}
        up={pose.up}
        fov={pose.fov}
      />
      <OrbitControls
        key={`controls-${key}`}
        makeDefault
        target={pose.target}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
}

export function EvaluationSceneViewport({
  record,
  taskCueBodies,
  taskCuesEnabled,
  onTaskCuesEnabledChange,
  updating = false,
}: {
  record: EvaluationSceneRecord;
  taskCueBodies: TaskCueBody[];
  taskCuesEnabled: boolean;
  onTaskCuesEnabledChange: (enabled: boolean) => void;
  updating?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [cameraMode, setCameraMode] = useState<CameraMode>("oblique");
  const [cameraReset, setCameraReset] = useState(0);
  const [load, setLoad] = useState<{
    key: string;
    phase: "loading" | "ready" | "error";
    error: Error | null;
    attempt: number;
  }>({ key: record.condition.task_key, phase: "loading", error: null, attempt: 0 });
  const currentLoad =
    load.key === record.condition.task_key
      ? load
      : { key: record.condition.task_key, phase: "loading" as const, error: null, attempt: 0 };
  const onReady = useCallback(() => {
    setLoad((value) => ({
      key: record.condition.task_key,
      phase: "ready",
      error: null,
      attempt: value.key === record.condition.task_key ? value.attempt : 0,
    }));
  }, [record.condition.task_key]);
  const onError = useCallback(
    (error: Error) => {
      setLoad((value) => ({
        key: record.condition.task_key,
        phase: "error",
        error,
        attempt: value.key === record.condition.task_key ? value.attempt : 0,
      }));
    },
    [record.condition.task_key],
  );
  const retry = useCallback(() => {
    useGLTF.clear(record.geometry_pack_asset_id);
    useLoader.clear(THREE.TextureLoader, evaluationTextureUrls(record));
    setLoad((value) => ({
      key: record.condition.task_key,
      phase: "loading",
      error: null,
      attempt: (value.key === record.condition.task_key ? value.attempt : 0) + 1,
    }));
  }, [record]);
  const enterFullscreen = useCallback(() => {
    void rootRef.current?.requestFullscreen();
  }, []);
  const hasFront = record.snapshot.cameras.some(
    (camera) => camera.camera === "agentview" && camera.scope === "fixed_world",
  );
  return (
    <section
      ref={rootRef}
      className="relative flex h-full min-h-0 flex-col bg-base-100"
      data-testid="evaluation-scene-viewport"
      data-scene-state={currentLoad.phase}
      data-scene-condition={record.condition.task_key}
    >
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-1 border-b border-base-300 px-2 py-1.5">
        <Button
          size="xs"
          variant={cameraMode === "oblique" ? "primary" : "ghost"}
          aria-pressed={cameraMode === "oblique"}
          onClick={() => setCameraMode("oblique")}
        >
          <Box size={14} /> Oblique
        </Button>
        <Button
          size="xs"
          variant={cameraMode === "front" ? "primary" : "ghost"}
          aria-pressed={cameraMode === "front"}
          disabled={!hasFront}
          onClick={() => setCameraMode("front")}
        >
          <Camera size={14} /> Front
        </Button>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label="Reset 3D camera"
          onClick={() => setCameraReset((value) => value + 1)}
        >
          <RefreshCw size={14} />
        </IconButton>
        <Button
          size="xs"
          variant={taskCuesEnabled ? "secondary" : "ghost"}
          aria-pressed={taskCuesEnabled}
          disabled={!taskCueBodies.length}
          onClick={() => onTaskCuesEnabledChange(!taskCuesEnabled)}
        >
          <Focus size={14} /> Task cues
        </Button>
        <IconButton
          size="xs"
          variant="ghost"
          className="ml-auto"
          aria-label="Open initial scene fullscreen"
          onClick={enterFullscreen}
        >
          <Expand size={14} />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1 bg-[#111411]">
        <Canvas
          role="img"
          aria-label={`Interactive initial 3D scene for ${record.condition.name}. Drag to orbit and use the wheel to zoom.`}
          gl={{ antialias: true, alpha: true, toneMapping: THREE.NoToneMapping }}
          dpr={[1, 2]}
          shadows
          onCreated={({ gl, scene }) => {
            gl.outputColorSpace = THREE.SRGBColorSpace;
            gl.toneMapping = THREE.NoToneMapping;
            scene.up.set(0, 0, 1);
          }}
        >
          <CameraRig mode={cameraMode} reset={cameraReset} record={record} />
          <EvaluationSceneErrorBoundary
            key={`${record.condition.task_key}-${currentLoad.attempt}`}
            onError={onError}
          >
            <Suspense fallback={null}>
              <EvaluationDigitalTwin
                record={record}
                taskCueBodies={taskCueBodies}
                taskCuesEnabled={taskCuesEnabled}
                reducedMotion={reducedMotion}
                onReady={onReady}
              />
            </Suspense>
          </EvaluationSceneErrorBoundary>
        </Canvas>
        {currentLoad.phase === "loading" ? (
          <div className="absolute inset-0 grid place-items-center bg-[#111411]/82 p-8">
            <div className="w-full max-w-sm">
              <Skeleton className="h-2 w-full bg-white/10" />
              <p className="mt-3 text-center text-xs text-white/65">
                Loading official scene assets…
              </p>
            </div>
          </div>
        ) : null}
        {currentLoad.phase === "error" ? (
          <div className="absolute inset-0 grid place-items-center bg-[#111411]/92 p-8 text-center">
            <div>
              <p className="font-semibold text-white">Initial scene failed to load.</p>
              <p className="mt-1 max-w-md text-xs text-white/55" title={currentLoad.error?.message}>
                The geometry pack or one of its source textures did not pass browser loading.
              </p>
              <Button size="sm" variant="secondary" className="mt-4" onClick={retry}>
                Retry
              </Button>
            </div>
          </div>
        ) : null}
        {updating && currentLoad.phase === "ready" ? (
          <div className="pointer-events-none absolute right-3 top-3 rounded-field bg-black/60 px-2 py-1 text-xs text-white/75">
            Updating condition…
          </div>
        ) : null}
      </div>
    </section>
  );
}
