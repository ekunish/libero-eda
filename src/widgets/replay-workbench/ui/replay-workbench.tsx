"use client";

import { OrbitControls, PerspectiveCamera, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { EChartsOption, SeriesOption } from "echarts";
import {
  ArrowLeft,
  Camera,
  ChevronLeft,
  ChevronRight,
  FlipHorizontal2,
  FlipVertical2,
  Gauge,
  Grid3X3,
  Layers3,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Play,
  Repeat2,
  Rotate3D,
  RotateCcw,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Component,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Panel, Group as PanelGroup, Separator } from "react-resizable-panels";
import type { Group, Object3D } from "three";
import * as THREE from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { EvaluationLanguageCandidates } from "@/features/inspect-plus-training-metadata";
import {
  api,
  mediaUrl,
  type ReplayContext,
  type ReplayManifest,
  type ReplaySeries,
  type ReplayVideo,
  type TaskDetail,
} from "@/shared/api";
import { cn, fixed, formatDuration } from "@/shared/lib/utils";
import { Chart, chartTextColor } from "@/shared/ui/chart";
import { Badge, Button, ErrorPanel, IconButton, Select, Skeleton } from "@/shared/ui/primitives";
import { fixedCameraPoseFromCalibration } from "../model/camera-pose";
import { rotationVectorQuaternion } from "../model/eef-orientation";
import { GRIPPER_TRAJECTORY_STYLES } from "../model/gripper-trajectory";
import {
  aggregateAmbient,
  createMujocoCubeTexture,
  createMujocoPhongMaterial,
  type MujocoLight,
  type MujocoRenderContract,
  mujocoCubeScale,
  parseMujocoMaterial,
  parseMujocoRenderContract,
} from "../model/mujoco-render";
import {
  replayContextPath,
  replayHref,
  safeReplayReturnPath,
  sanitizeReplayParams,
} from "../model/replay-context-url";
import { shouldHideSceneNode } from "../model/scene-visibility";
import {
  createTaskCueMaterialBindings,
  type TaskCueMaterial,
  taskCuePulsePhase,
  updateTaskCueMaterial,
} from "../model/task-cue-appearance";
import {
  parseTaskDefinition,
  resolveTaskCues,
  type TaskCueBody,
  type TaskCueResolution,
} from "../model/task-cues";
import {
  buildStaticTrajectorySegments,
  TRAJECTORY_FLOW,
  type TrajectoryTemporalRegion,
} from "../model/trajectory-appearance";
import { usePlayback } from "../model/use-playback";
import { useReducedMotion } from "../model/use-reduced-motion";
import {
  cssVideoTransform,
  resetVideoTransform,
  resolveVideoOrientation,
  saveVideoTransform,
  type VideoTransform,
} from "../model/video-orientation";
import { clampVideoTime, videoTimeForSeriesFrame } from "../model/video-time";
import { AnimatedRainbowTrajectory } from "./animated-trajectory";
import { ReplayNavigator } from "./replay-navigator";
import { TaskDefinitionInspector } from "./task-definition-inspector";

const EMPTY_TASK_CUE_BODIES: TaskCueBody[] = [];

function PlaybackTicker() {
  const playing = usePlayback((state) => state.playing);
  const fps = usePlayback((state) => state.fps);
  const speed = usePlayback((state) => state.speed);
  const maxFrame = usePlayback((state) => state.maxFrame);
  const loop = usePlayback((state) => state.loop);
  const setFrame = usePlayback((state) => state.setFrame);
  const setPlaying = usePlayback((state) => state.setPlaying);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const start = performance.now();
    const startFrame = usePlayback.getState().frame;
    const tick = (now: number) => {
      const next = startFrame + ((now - start) / 1000) * fps * speed;
      if (next >= maxFrame) {
        if (loop) {
          setFrame(next % Math.max(maxFrame + 1, 1));
          raf = requestAnimationFrame(tick);
        } else {
          setFrame(maxFrame);
          setPlaying(false);
        }
        return;
      }
      setFrame(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, fps, speed, maxFrame, loop, setFrame, setPlaying]);
  return null;
}

type DimensionedReplayVideo = ReplayVideo & { width: number; height: number };

function hasRecordedVideoDimensions(video: ReplayVideo): video is DimensionedReplayVideo {
  return video.width !== null && video.height !== null;
}

function VideoToolbarButton({
  active = false,
  className,
  ...props
}: ComponentProps<typeof IconButton> & { active?: boolean }) {
  return (
    <IconButton
      size="sm"
      variant="ghost"
      className={cn(
        "size-10 min-h-10 shrink-0 border border-white/20 p-0 text-white hover:bg-black/80",
        active ? "bg-white/25" : "bg-black/60",
        className,
      )}
      {...props}
    />
  );
}

function SyncedVideo({
  manifest,
  video,
  label,
}: {
  manifest: ReplayManifest;
  video: DimensionedReplayVideo;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [orientation, setOrientation] = useState(() => resolveVideoOrientation(manifest, video));
  const [metadataReady, setMetadataReady] = useState(false);
  const frame = usePlayback((state) => state.frame);
  const playing = usePlayback((state) => state.playing);
  const speed = usePlayback((state) => state.speed);
  const requestedTime = videoTimeForSeriesFrame(manifest, video, frame);
  useEffect(() => {
    const element = ref.current;
    if (!element || !metadataReady) return;
    const expected = clampVideoTime(requestedTime, element.duration);
    element.playbackRate = speed;
    if (!playing) {
      element.pause();
      if (Math.abs(element.currentTime - expected) > 0.012) element.currentTime = expected;
      return;
    }
    if (Math.abs(element.currentTime - expected) > 0.025) element.currentTime = expected;
    void element.play().catch(() => undefined);
  }, [metadataReady, playing, requestedTime, speed]);
  const updateTransform = (transform: VideoTransform) => {
    saveVideoTransform(manifest, video, transform);
    setOrientation({ mode: "saved", transform, isKnownDefault: orientation.isKnownDefault });
  };
  const resetOrientation = () => {
    resetVideoTransform(manifest, video);
    setOrientation(resolveVideoOrientation(manifest, video));
  };
  const resetDescription =
    manifest.dataset_id === "lerobot_libero_plus"
      ? "Reset to simulator orientation; the published source MP4 is rotated 180 degrees"
      : "Reset to the recorded source orientation";
  return (
    <div
      className="replay-video-pane grid h-auto min-h-[11.25rem] min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] overflow-hidden border border-[var(--line)] bg-base-100"
      data-testid={`video-pane-${video.camera}`}
      style={{ "--replay-video-aspect": `${video.width}/${video.height}` } as CSSProperties}
    >
      <fieldset
        className="flex min-h-0 w-11 flex-col items-center gap-1 overflow-y-auto border-r border-white/15 bg-neutral px-0.5 py-1 text-neutral-content"
        data-testid={`video-orientation-toolbar-${video.camera}`}
      >
        <legend className="sr-only">{label} display orientation</legend>
        <VideoToolbarButton
          active={orientation.transform.flipVertical}
          className="text-xs"
          title="Flip vertically"
          aria-label={`Flip ${label} vertically`}
          aria-pressed={orientation.transform.flipVertical}
          onClick={() =>
            updateTransform({
              ...orientation.transform,
              flipVertical: !orientation.transform.flipVertical,
            })
          }
        >
          <FlipVertical2 size={13} />
        </VideoToolbarButton>
        <VideoToolbarButton
          active={orientation.transform.flipHorizontal}
          className="text-xs"
          title="Flip horizontally"
          aria-label={`Flip ${label} horizontally`}
          aria-pressed={orientation.transform.flipHorizontal}
          onClick={() =>
            updateTransform({
              ...orientation.transform,
              flipHorizontal: !orientation.transform.flipHorizontal,
            })
          }
        >
          <FlipHorizontal2 size={13} />
        </VideoToolbarButton>
        <VideoToolbarButton
          className="text-xs"
          title="Rotate 180 degrees"
          aria-label={`Rotate ${label} 180 degrees`}
          onClick={() =>
            updateTransform({
              flipHorizontal: !orientation.transform.flipHorizontal,
              flipVertical: !orientation.transform.flipVertical,
            })
          }
        >
          180°
        </VideoToolbarButton>
        <VideoToolbarButton
          className="disabled:text-white/35"
          title={resetDescription}
          aria-label={`Reset ${label} orientation. ${resetDescription}`}
          disabled={orientation.mode !== "saved"}
          onClick={resetOrientation}
        >
          <RotateCcw size={13} />
        </VideoToolbarButton>
      </fieldset>
      <div
        className="replay-video-media relative min-h-0 w-full overflow-hidden bg-black"
        data-testid={`video-media-${video.camera}`}
      >
        <video
          ref={ref}
          src={mediaUrl(video.asset_id)}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={() => setMetadataReady(true)}
          className="size-full object-contain"
          style={{ transform: cssVideoTransform(orientation.transform) }}
          aria-label={`${label} synchronized video`}
        />
      </div>
    </div>
  );
}

const reflectorShader = {
  uniforms: {
    color: { value: null },
    reflectance: { value: 0.0 },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float reflectance;
    varying vec4 vUv;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec3 reflected = texture2DProj(tDiffuse, vUv).rgb;
      gl_FragColor = vec4(reflected, reflectance);
      #include <colorspace_fragment>
    }
  `,
};

export function addPlanarReflector(mesh: THREE.Mesh): void {
  const reflective = mesh.userData.mujocoReflectiveSurface as
    | { kind: "plane" | "box_top"; reflectance: number }
    | undefined;
  if (!reflective || reflective.reflectance <= 0) return;
  const size = mesh.userData.mujocoGeomSize as [number, number, number] | undefined;
  let geometry: THREE.BufferGeometry;
  let ownsGeometry = false;
  if (reflective.kind === "plane") {
    geometry = mesh.geometry;
  } else {
    if (size?.length !== 3 || size.some((value) => !Number.isFinite(value))) {
      throw new Error(`Invalid reflective box dimensions in Scene v3: ${mesh.name}`);
    }
    geometry = new THREE.PlaneGeometry(size[0] * 2, size[1] * 2);
    ownsGeometry = true;
  }
  const reflector = new Reflector(geometry, {
    clipBias: 0.001,
    color: 0xffffff,
    textureWidth: 1024,
    textureHeight: 1024,
    multisample: 0,
    shader: reflectorShader,
  });
  const material = reflector.material as THREE.ShaderMaterial;
  const reflectanceUniform = material.uniforms.reflectance;
  if (!reflectanceUniform) throw new Error("MuJoCo reflection uniform is missing");
  reflectanceUniform.value = reflective.reflectance;
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.NormalBlending;
  reflector.name = `${mesh.name}__mujoco_reflection`;
  reflector.renderOrder = 10;
  reflector.position.z = reflective.kind === "box_top" ? (size?.[2] ?? 0) + 0.0002 : 0.0002;
  reflector.userData.parcReflectionOverlay = true;
  reflector.userData.parcOwnsGeometry = ownsGeometry;
  mesh.add(reflector);
}

function sourceLightObject(light: MujocoLight, shadowMapSize: number): THREE.Light {
  const color = new THREE.Color(...light.diffuse);
  let result: THREE.Light;
  if (light.type === "directional") {
    result = new THREE.DirectionalLight(color, 1);
  } else if (light.type === "point") {
    result = new THREE.PointLight(color, 1, 0, 0);
  } else {
    const penumbra = THREE.MathUtils.clamp(1 / Math.max(light.exponent, 1), 0, 1);
    result = new THREE.SpotLight(
      color,
      1,
      0,
      THREE.MathUtils.degToRad(light.cutoff_degrees),
      penumbra,
      0,
    );
  }
  result.name = light.name;
  result.position.fromArray(light.position);
  result.castShadow = light.cast_shadow;
  result.userData.mujocoLight = structuredClone(light);
  if (
    result instanceof THREE.DirectionalLight ||
    result instanceof THREE.PointLight ||
    result instanceof THREE.SpotLight
  ) {
    result.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  }
  if (result instanceof THREE.DirectionalLight || result instanceof THREE.SpotLight) {
    result.target.position
      .fromArray(light.position)
      .add(new THREE.Vector3().fromArray(light.direction).normalize());
  }
  return result;
}

export function MujocoLights({ render }: { render: MujocoRenderContract }) {
  const group = useMemo(() => {
    const root = new THREE.Group();
    root.name = "MuJoCo source lights";
    const ambient = new THREE.AmbientLight(aggregateAmbient(render), 1);
    ambient.name = "MuJoCo ambient";
    root.add(ambient);
    for (const light of render.lights) {
      if (!light.active) continue;
      const object = sourceLightObject(light, render.shadow_map_size);
      root.add(object);
      if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight) {
        root.add(object.target);
      }
    }
    if (render.headlight.active) {
      const headlight = new THREE.DirectionalLight(new THREE.Color(...render.headlight.diffuse), 1);
      headlight.name = "MuJoCo camera headlight";
      headlight.userData.parcHeadlight = true;
      root.add(headlight, headlight.target);
    }
    return root;
  }, [render]);
  useFrame(({ camera }) => {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    for (const object of group.children) {
      if (!(object instanceof THREE.DirectionalLight) || !object.userData.parcHeadlight) continue;
      object.position.copy(camera.position);
      object.target.position.copy(camera.position).add(direction);
      object.target.updateMatrixWorld();
    }
  });
  return <primitive object={group} />;
}

function MujocoSkybox({
  parser,
  render,
}: {
  parser: { getDependency: (type: string, index: number) => Promise<unknown> };
  render: MujocoRenderContract;
}) {
  const getThree = useThree((state) => state.get);
  const [error, setError] = useState<Error | null>(null);
  if (error) throw error;
  useEffect(() => {
    const root = getThree().scene;
    const skybox = render.skybox;
    if (!skybox) {
      root.background = null;
      return;
    }
    let cancelled = false;
    let cube: THREE.CubeTexture | null = null;
    void parser
      .getDependency("texture", skybox.texture)
      .then((value) => {
        if (cancelled) return;
        if (!(value instanceof THREE.Texture)) {
          throw new Error("Could not read the Scene v3 skybox texture");
        }
        const image = value.image as CanvasImageSource | undefined;
        if (!image) throw new Error("Could not read the Scene v3 skybox image");
        const faces = Array.from({ length: 6 }, (_, index) => {
          const canvas = document.createElement("canvas");
          canvas.width = skybox.face_size;
          canvas.height = skybox.face_size;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not create the Scene v3 skybox canvas");
          context.drawImage(
            image,
            0,
            index * skybox.face_size,
            skybox.face_size,
            skybox.face_size,
            0,
            0,
            skybox.face_size,
            skybox.face_size,
          );
          return canvas;
        });
        cube = new THREE.CubeTexture(faces);
        cube.colorSpace = THREE.SRGBColorSpace;
        cube.needsUpdate = true;
        root.background = cube;
        root.backgroundRotation.set(Math.PI / 2, 0, 0);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason : new Error(String(reason)));
        }
      });
    return () => {
      cancelled = true;
      if (root.background === cube) root.background = null;
      cube?.dispose();
    };
  }, [getThree, parser, render.skybox]);
  return null;
}

function DigitalTwin({
  manifest,
  series,
  frame,
  taskCueBodies,
  taskCuesEnabled,
  reducedMotion,
  onReady,
}: {
  manifest: ReplayManifest;
  series: ReplaySeries;
  frame: number;
  taskCueBodies: TaskCueBody[];
  taskCuesEnabled: boolean;
  reducedMotion: boolean;
  onReady: () => void;
}) {
  const gltf = useGLTF(mediaUrl(manifest.scene_asset_id as string)) as {
    scene: Group;
    parser: {
      json: unknown;
      getDependency: (type: string, index: number) => Promise<unknown>;
    };
  };
  const render = useMemo(
    () =>
      manifest.scene_schema === "parc-mujoco-scene/v3"
        ? parseMujocoRenderContract(gltf.parser.json)
        : null,
    [gltf.parser.json, manifest.scene_schema],
  );
  const taskCueRoles = useMemo(
    () => new Map(taskCueBodies.map((body) => [body.bodyName, new Set(body.roles)])),
    [taskCueBodies],
  );
  const scene = useMemo(() => {
    const clone = gltf.scene.clone(true);
    const cubeBySource = new Map<THREE.Texture, THREE.CubeTexture>();
    const cubeTextures = new Set<THREE.CubeTexture>();
    const taskCueMaterials: TaskCueMaterial[] = [];
    const shadows = render?.lights.some((light) => light.active && light.cast_shadow) ?? false;
    clone.traverse((object) => {
      if (shouldHideSceneNode(manifest.scene_schema, object.name)) {
        object.visible = false;
      }
      if (!render || !(object instanceof THREE.Mesh) || object.userData.parcReflectionOverlay)
        return;
      const sourceMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const converted = sourceMaterials.map((source) => {
        const classic = parseMujocoMaterial(source);
        let cubeMapping: { texture: THREE.CubeTexture; scale: THREE.Vector3 } | undefined;
        if (classic.texture_type === 1) {
          const sourceMap = (source as THREE.Material & { map?: THREE.Texture | null }).map;
          if (!sourceMap) throw new Error(`Scene v3 cube texture is missing: ${object.name}`);
          let cube = cubeBySource.get(sourceMap);
          if (!cube) {
            cube = createMujocoCubeTexture(sourceMap);
            cubeBySource.set(sourceMap, cube);
            cubeTextures.add(cube);
          }
          const geomType = object.userData.mujocoGeomType as number | undefined;
          const size = object.userData.mujocoGeomSize as [number, number, number] | undefined;
          if (typeof geomType !== "number" || !Number.isInteger(geomType) || size?.length !== 3) {
            throw new Error(`Invalid Scene v3 cube-texture geometry: ${object.name}`);
          }
          cubeMapping = {
            texture: cube,
            scale: mujocoCubeScale(geomType, size, classic.texuniform),
          };
        }
        return createMujocoPhongMaterial(source, classic, render, cubeMapping);
      });
      object.material = Array.isArray(object.material) ? converted : converted[0];
      object.castShadow = shadows;
      object.receiveShadow = shadows;
      addPlanarReflector(object);
      const bodyIndex = object.userData.mujocoBodyIndex as number | undefined;
      const bodyName = bodyIndex == null ? undefined : manifest.body_names[bodyIndex];
      const roles = bodyName ? taskCueRoles.get(bodyName) : undefined;
      if (roles?.size) {
        taskCueMaterials.push(...createTaskCueMaterialBindings(converted, roles));
      }
    });
    clone.userData.parcMujocoCubeTextures = cubeTextures;
    clone.userData.parcTaskCueMaterials = taskCueMaterials;
    return clone;
  }, [gltf.scene, manifest.body_names, manifest.scene_schema, render, taskCueRoles]);
  useFrame(({ clock }) => {
    const materials = scene.userData.parcTaskCueMaterials as TaskCueMaterial[] | undefined;
    const phase = taskCuePulsePhase(clock.getElapsedTime(), reducedMotion);
    for (const binding of materials ?? []) {
      updateTaskCueMaterial(binding, taskCuesEnabled, phase);
    }
  });
  useEffect(
    () => () => {
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (material.userData.parcMujocoConverted) material.dispose();
          }
        }
        if (object instanceof Reflector) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) material.dispose();
          object.getRenderTarget().dispose();
          if (object.userData.parcOwnsGeometry) object.geometry.dispose();
        }
      });
      const cubeTextures = scene.userData.parcMujocoCubeTextures as
        | Set<THREE.CubeTexture>
        | undefined;
      for (const texture of cubeTextures ?? []) texture.dispose();
    },
    [scene],
  );
  useEffect(() => {
    const positions = series.body_positions[frame];
    const quaternions = series.body_quaternions[frame];
    if (!positions || !quaternions) return;
    scene.traverse((object: Object3D) => {
      const index = object.userData.mujocoBodyIndex as number | undefined;
      if (index == null || object.parent !== scene) return;
      const position = positions[index];
      const quaternion = quaternions[index];
      if (!position || !quaternion) return;
      object.position.set(position[0] ?? 0, position[1] ?? 0, position[2] ?? 0);
      object.quaternion.set(
        quaternion[1] ?? 0,
        quaternion[2] ?? 0,
        quaternion[3] ?? 0,
        quaternion[0] ?? 1,
      );
    });
  }, [frame, scene, series.body_positions, series.body_quaternions]);
  useEffect(() => {
    onReady();
  }, [onReady]);
  return (
    <>
      {render ? <MujocoLights render={render} /> : null}
      {render ? <MujocoSkybox parser={gltf.parser} render={render} /> : null}
      <primitive object={scene} />
    </>
  );
}

class SceneModelErrorBoundary extends Component<
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

type SceneModelLoadState = {
  assetId: string;
  phase: "loading" | "ready" | "error";
  attempt: number;
  error: Error | null;
};

function TrajectoryScene({
  manifest,
  series,
  frame,
  showTwin,
  cameraMode,
  cameraReset,
  sceneAttempt,
  reducedMotion,
  taskCueBodies,
  taskCuesEnabled,
  onSceneReady,
  onSceneError,
}: {
  manifest: ReplayManifest;
  series: ReplaySeries;
  frame: number;
  showTwin: boolean;
  cameraMode: "front" | "oblique";
  cameraReset: number;
  sceneAttempt: number;
  reducedMotion: boolean;
  taskCueBodies: TaskCueBody[];
  taskCuesEnabled: boolean;
  onSceneReady: () => void;
  onSceneError: (error: Error) => void;
}) {
  const points = useMemo(
    () =>
      series.ee_positions.map(
        (point) => new THREE.Vector3(point[0] ?? 0, point[1] ?? 0, point[2] ?? 0),
      ),
    [series.ee_positions],
  );
  const current = points[Math.min(frame, points.length - 1)] ?? new THREE.Vector3();
  const axisAngle = series.ee_axis_angle ?? [];
  const currentOrientation = rotationVectorQuaternion(
    axisAngle[Math.min(frame, Math.max(axisAngle.length - 1, 0))],
  );
  const center = useMemo(() => {
    if (!points.length) return new THREE.Vector3(0, 0, 0.8);
    const box = new THREE.Box3().setFromPoints(points);
    return box.getCenter(new THREE.Vector3());
  }, [points]);
  const agentviewCalibration = manifest.scene_cameras.find(
    (camera) => camera.camera === "agentview" && camera.scope === "fixed_world",
  );
  const cameraPose = useMemo(() => {
    if (cameraMode === "front" && agentviewCalibration) {
      return fixedCameraPoseFromCalibration(agentviewCalibration);
    }
    return {
      position: [center.x + 1.2, center.y - 1.5, center.z + 1.1] as [number, number, number],
      quaternion: undefined,
      target: center.toArray(),
      up: [0, 0, 1] as [number, number, number],
      fov: 43,
    };
  }, [agentviewCalibration, cameraMode, center]);
  const cameraKey = `${cameraMode}-${cameraReset}`;
  const motionDescription = reducedMotion
    ? "Rainbow motion is frozen by the reduced-motion preference."
    : "The rainbow flows continuously, including while Replay is paused.";
  const manipulatedBodyCount = taskCueBodies.filter((body) =>
    body.roles.includes("manipulated"),
  ).length;
  const destinationBodyCount = taskCueBodies.filter((body) =>
    body.roles.includes("destination"),
  ).length;
  const taskCueDescription =
    showTwin && taskCuesEnabled && taskCueBodies.length
      ? ` Task cues pulse ${manipulatedBodyCount} manipulated bodies in yellow and ${destinationBodyCount} destination bodies in blue; bodies with both roles pulse in white.`
      : "";
  return (
    <Canvas
      role="img"
      aria-label={
        showTwin
          ? `3D view of the robot, objects, and EEF trajectory. Hue encodes the gripper command, opacity distinguishes passed, current, and upcoming points, and the ring marker follows the current trajectory hue. ${motionDescription}${taskCueDescription} Current frame ${frame}.`
          : `3D view of the EEF trajectory. Hue encodes the gripper command, opacity distinguishes passed, current, and upcoming points, and the ring marker follows the current trajectory hue. ${motionDescription} Current frame ${frame}.`
      }
      gl={{ antialias: true, alpha: true, toneMapping: THREE.NoToneMapping }}
      dpr={[1, 2]}
      shadows={showTwin}
      onCreated={({ gl, scene: root }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace;
        gl.toneMapping = THREE.NoToneMapping;
        root.up.set(0, 0, 1);
      }}
    >
      <PerspectiveCamera
        key={`camera-${cameraKey}`}
        makeDefault
        position={cameraPose.position}
        quaternion={cameraPose.quaternion}
        fov={cameraPose.fov}
        up={cameraPose.up}
      />
      {!showTwin ? (
        <gridHelper
          args={[3, 30, "#777b74", "#454943"]}
          rotation={[Math.PI / 2, 0, 0]}
          position={[0, 0, 0]}
        />
      ) : null}
      {showTwin && manifest.scene_asset_id && series.body_positions.length ? (
        <SceneModelErrorBoundary
          key={`${manifest.scene_asset_id}-${sceneAttempt}`}
          onError={onSceneError}
        >
          <Suspense fallback={null}>
            <DigitalTwin
              manifest={manifest}
              series={series}
              frame={frame}
              taskCueBodies={taskCueBodies}
              taskCuesEnabled={taskCuesEnabled}
              reducedMotion={reducedMotion}
              onReady={onSceneReady}
            />
          </Suspense>
        </SceneModelErrorBoundary>
      ) : null}
      <AnimatedRainbowTrajectory
        positions={series.ee_positions}
        actions={series.actions}
        frame={frame}
        reducedMotion={reducedMotion}
      />
      {currentOrientation ? (
        <group position={current} quaternion={currentOrientation}>
          <axesHelper args={[0.065]} />
        </group>
      ) : null}
      <OrbitControls
        key={`controls-${cameraKey}`}
        makeDefault
        target={cameraPose.target}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
}

function ProjectionChart({ series, frame }: { series: ReplaySeries; frame: number }) {
  const text = chartTextColor();
  const points = series.ee_positions;
  const trajectorySegments = buildStaticTrajectorySegments(
    series.ee_positions,
    series.actions,
    frame,
  );
  const current = points[Math.min(frame, points.length - 1)] ?? [0, 0, 0];
  const currentIndex = Math.min(frame, Math.max(points.length - 1, 0));
  const currentSegment =
    trajectorySegments.find((segment) => segment.startIndex === currentIndex) ??
    trajectorySegments.find((segment) => segment.endIndex === currentIndex) ??
    trajectorySegments.at(-1);
  const currentColor = currentSegment?.color ?? GRIPPER_TRAJECTORY_STYLES.unknown.color;
  const regionOpacity: Record<TrajectoryTemporalRegion, number> = {
    past: TRAJECTORY_FLOW.pastOpacity,
    current: 1,
    future: TRAJECTORY_FLOW.futureOpacity,
  };
  const trajectorySeries: SeriesOption[] = trajectorySegments.flatMap((segment) => {
    const style = GRIPPER_TRAJECTORY_STYLES[segment.state];
    return [
      {
        id: `xy-${segment.state}-${segment.region}-${segment.startIndex}`,
        type: "line",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: segment.points.map((point) => [point[0], point[1]]),
        showSymbol: false,
        silent: true,
        lineStyle: {
          color: segment.color,
          opacity: regionOpacity[segment.region],
          width: style.lineWidth,
          type: style.lineType,
        },
      },
      {
        id: `xz-${segment.state}-${segment.region}-${segment.startIndex}`,
        type: "line",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: segment.points.map((point) => [point[0], point[2]]),
        showSymbol: false,
        silent: true,
        lineStyle: {
          color: segment.color,
          opacity: regionOpacity[segment.region],
          width: style.lineWidth,
          type: style.lineType,
        },
      },
    ];
  });
  const option: EChartsOption = {
    animation: false,
    grid: [
      { left: 44, top: 52, width: "40%", bottom: 35 },
      { right: 15, top: 52, width: "40%", bottom: 35 },
    ],
    xAxis: [
      {
        type: "value",
        name: "x",
        gridIndex: 0,
        axisLabel: { color: text },
        splitLine: { lineStyle: { color: "rgba(130,150,175,.1)" } },
      },
      {
        type: "value",
        name: "x",
        gridIndex: 1,
        axisLabel: { color: text },
        splitLine: { lineStyle: { color: "rgba(130,150,175,.1)" } },
      },
    ],
    yAxis: [
      {
        type: "value",
        name: "y",
        gridIndex: 0,
        axisLabel: { color: text },
        splitLine: { lineStyle: { color: "rgba(130,150,175,.1)" } },
      },
      {
        type: "value",
        name: "z",
        gridIndex: 1,
        axisLabel: { color: text },
        splitLine: { lineStyle: { color: "rgba(130,150,175,.1)" } },
      },
    ],
    series: [
      ...trajectorySeries,
      {
        type: "scatter",
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: [[current[0], current[1]]],
        symbolSize: 7,
        itemStyle: { color: currentColor, borderColor: text, borderWidth: 1 },
      },
      {
        type: "scatter",
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: [[current[0], current[2]]],
        symbolSize: 7,
        itemStyle: { color: currentColor, borderColor: text, borderWidth: 1 },
      },
    ],
  };
  return (
    <Chart
      option={option}
      height={210}
      ariaLabel={`EEF trajectory projected onto world XY and XZ. Hue encodes the gripper command and opacity distinguishes passed, current, and upcoming points. Current frame ${frame}.`}
    />
  );
}

function TimeseriesChart({
  series,
  frame,
  fps,
  maxFrame,
}: {
  series: ReplaySeries;
  frame: number;
  fps: number;
  maxFrame: number;
}) {
  const text = chartTextColor();
  const colors = ["#356f63", "#4d7180", "#5f795f", "#706785", "#a07432", "#a85649", "#8a6378"];
  const actionSeries: SeriesOption[] = Array.from({ length: 7 }, (_, dim) => ({
    type: "line",
    name: ["dx", "dy", "dz", "droll", "dpitch", "dyaw", "gripper"][dim],
    data: series.actions.map((action, index) => [index / fps, action[dim] ?? 0]),
    showSymbol: false,
    lineStyle: {
      width: 1.2,
      color: colors[dim],
      type: dim === 6 ? "dotted" : dim >= 3 ? "dashed" : "solid",
    },
    emphasis: { focus: "series" },
  }));
  const option: EChartsOption = {
    animation: false,
    tooltip: { trigger: "axis" },
    legend: {
      top: 0,
      textStyle: { color: text },
      itemWidth: 14,
      itemHeight: 3,
    },
    grid: { left: 48, right: 18, top: 42, bottom: 30 },
    xAxis: {
      type: "value",
      min: 0,
      max: maxFrame / fps,
      axisLabel: { color: text },
      splitLine: { lineStyle: { color: "rgba(130,150,175,.1)" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: text },
      splitLine: { lineStyle: { color: "rgba(130,150,175,.1)" } },
    },
    series: actionSeries,
  };
  return (
    <Chart
      option={option}
      height="100%"
      ariaLabel={`Seven-dimensional action time series. Current frame ${frame}, ${(frame / fps).toFixed(2)} seconds.`}
    />
  );
}

function PlaybackControls({ manifest }: { manifest: ReplayManifest }) {
  const frame = usePlayback((state) => state.frame);
  const maxFrame = usePlayback((state) => state.maxFrame);
  const playing = usePlayback((state) => state.playing);
  const speed = usePlayback((state) => state.speed);
  const loop = usePlayback((state) => state.loop);
  const setFrame = usePlayback((state) => state.setFrame);
  const setSpeed = usePlayback((state) => state.setSpeed);
  const setLoop = usePlayback((state) => state.setLoop);
  const togglePlaying = usePlayback((state) => state.togglePlaying);
  const step = usePlayback((state) => state.step);
  const progress = maxFrame > 0 ? frame / maxFrame : 0;
  return (
    <div className="border-t border-[var(--line)] bg-[var(--surface)] px-2 py-2">
      <div
        className="relative mb-2 h-5"
        data-testid="replay-playhead-domain"
        style={{ marginLeft: 48, marginRight: 18 }}
      >
        <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-primary/15" />
        <span
          className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-base-100"
          data-testid="replay-playhead-marker"
          style={{ left: `${progress * 100}%` }}
        />
        <input
          aria-label="Replay playhead"
          type="range"
          min={0}
          max={maxFrame}
          step={1}
          value={frame}
          onChange={(event) => setFrame(Number(event.target.value))}
          className="replay-time-input absolute -left-1.5 top-0 z-10 h-5 w-[calc(100%+0.75rem)] cursor-pointer"
        />
      </div>
      <div
        className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2"
        data-testid="replay-controls-row"
      >
        <div className="mono min-w-0 justify-self-start text-xs">
          <span className="whitespace-nowrap">
            <strong>{String(frame).padStart(3, "0")}</strong>
            <span className="hidden text-[var(--faint)] sm:inline">
              {" "}
              / {String(maxFrame).padStart(3, "0")}
            </span>
          </span>
          <span className="ml-3 hidden whitespace-nowrap text-[var(--muted)] sm:inline">
            {formatDuration(frame / manifest.fps)}
          </span>
        </div>
        <div
          className="flex items-center justify-center gap-1 justify-self-center"
          data-testid="replay-transport-controls"
        >
          <IconButton variant="ghost" onClick={() => step(-1)} aria-label="Previous frame">
            <ChevronLeft size={19} />
          </IconButton>
          <IconButton
            size="md"
            variant="primary"
            className="size-12 min-h-12 rounded-full p-0"
            data-testid="replay-play-toggle"
            onClick={togglePlaying}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <Pause size={22} fill="currentColor" />
            ) : (
              <Play className="translate-x-px" size={22} fill="currentColor" />
            )}
          </IconButton>
          <IconButton variant="ghost" onClick={() => step(1)} aria-label="Next frame">
            <ChevronRight size={19} />
          </IconButton>
        </div>
        <div className="flex min-w-0 items-center gap-2 justify-self-end">
          <IconButton
            size="sm"
            variant={loop ? "primary" : "ghost"}
            onClick={() => setLoop(!loop)}
            aria-label={loop ? "Disable loop" : "Enable loop"}
            aria-pressed={loop}
            title={loop ? "Disable loop" : "Enable loop"}
          >
            <Repeat2 size={16} />
          </IconButton>
          <Select
            size="xs"
            aria-label="Playback speed"
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            className="text-xs"
          >
            <option value={0.25}>0.25×</option>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </Select>
        </div>
      </div>
    </div>
  );
}

function subscribeDesktopWorkspace(callback: () => void): () => void {
  const media = window.matchMedia("(min-width: 1281px)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function desktopWorkspaceSnapshot(): boolean {
  return window.matchMedia("(min-width: 1281px)").matches;
}

function serverDesktopWorkspaceSnapshot(): boolean {
  return false;
}

function ReplayWorkbenchSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading replay workspace"
      aria-busy="true"
      className="viewport-page flex min-h-0 flex-col gap-2"
      data-testid="replay-workbench-skeleton"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border border-base-300 bg-base-100 px-3">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 min-w-32 max-w-xl flex-1" />
        <Skeleton className="size-8" />
        <Skeleton className="size-8" />
      </div>
      <div className="grid min-h-0 flex-1 gap-px overflow-hidden border border-base-300 bg-base-300 xl:grid-cols-[18rem_minmax(0,1fr)_19rem]">
        <aside className="hidden min-h-0 bg-base-100 xl:flex xl:flex-col">
          <div className="grid gap-2 border-b border-base-300 p-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
          <div className="grid gap-2 p-3">
            {["a", "b", "c", "d", "e", "f"].map((key) => (
              <Skeleton key={key} className="h-16 w-full" />
            ))}
          </div>
        </aside>
        <main className="grid min-h-0 bg-base-200 xl:grid-rows-[minmax(22rem,3fr)_minmax(15rem,2fr)]">
          <section className="grid min-h-[32rem] grid-rows-[2.5rem_minmax(0,1fr)] border-b border-base-300 xl:min-h-0">
            <div className="flex items-center gap-2 bg-base-100 px-3">
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-7 w-28" />
            </div>
            <div className="grid min-h-0 grid-cols-[minmax(11rem,.42fr)_minmax(0,1fr)] gap-px bg-base-300">
              <div className="grid grid-rows-2 gap-px bg-black p-2">
                <Skeleton className="h-full min-h-32 w-full bg-neutral/70" />
                <Skeleton className="h-full min-h-32 w-full bg-neutral/70" />
              </div>
              <Skeleton className="h-full w-full rounded-none" />
            </div>
          </section>
          <section className="grid min-h-[20rem] grid-rows-[3rem_2.5rem_minmax(0,1fr)] bg-base-100 xl:min-h-0">
            <div className="flex items-center gap-2 border-b border-base-300 px-3">
              <Skeleton className="size-8" />
              <Skeleton className="h-2 flex-1" />
              <Skeleton className="h-5 w-24" />
            </div>
            <div className="flex items-center gap-4 border-b border-base-300 px-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 flex-1" />
            </div>
            <Skeleton className="m-3 h-auto min-h-40 rounded-none" />
          </section>
        </main>
        <aside className="hidden min-h-0 bg-base-100 p-3 xl:grid xl:content-start xl:gap-4">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </aside>
      </div>
    </div>
  );
}

export function ReplayWorkbench({ replayId }: { replayId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reducedMotion = useReducedMotion();
  const serializedReplayParams = searchParams.toString();
  const workspaceQuery = useQuery({
    queryKey: ["replay-workspace", replayId],
    queryFn: async () => {
      const [manifest, series] = await Promise.all([
        api<ReplayManifest>(`/replays/${replayId}`),
        api<ReplaySeries>(`/replays/${replayId}/series`),
      ]);
      return { replayId, manifest, series };
    },
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
  const workspaceReadyForRoute = Boolean(workspaceQuery.data && !workspaceQuery.isPlaceholderData);
  const displayedReplayId = workspaceQuery.data?.replayId ?? replayId;
  const displayedManifest = workspaceQuery.data?.manifest;
  const displayedSeries = workspaceQuery.data?.series;
  const canonicalReplayParams = useMemo(
    () =>
      workspaceReadyForRoute && displayedManifest
        ? sanitizeReplayParams(new URLSearchParams(serializedReplayParams), displayedManifest)
        : new URLSearchParams(serializedReplayParams),
    [displayedManifest, serializedReplayParams, workspaceReadyForRoute],
  );
  const canonicalReplayParamsString = canonicalReplayParams.toString();
  const displayedReplayParams = useMemo(
    () =>
      displayedManifest
        ? sanitizeReplayParams(new URLSearchParams(serializedReplayParams), displayedManifest)
        : new URLSearchParams(serializedReplayParams),
    [displayedManifest, serializedReplayParams],
  );
  const displayedReplayParamsString = displayedReplayParams.toString();
  const contextQuery = useQuery({
    queryKey: ["replay-context", displayedReplayId, displayedReplayParamsString],
    queryFn: () =>
      api<ReplayContext>(
        replayContextPath(displayedReplayId, new URLSearchParams(displayedReplayParamsString)),
      ),
    enabled: Boolean(displayedManifest),
    placeholderData: keepPreviousData,
  });
  const configure = usePlayback((state) => state.configure);
  const frame = usePlayback((state) => state.frame);
  const togglePlaying = usePlayback((state) => state.togglePlaying);
  const step = usePlayback((state) => state.step);
  const replayRootRef = useRef<HTMLDivElement>(null);
  const [selectedView, setSelectedView] = useState<"scene" | "trajectory" | "projection" | null>(
    null,
  );
  const [selectedCameraMode, setSelectedCameraMode] = useState<"front" | "oblique" | null>(null);
  const desktopWorkspace = useSyncExternalStore(
    subscribeDesktopWorkspace,
    desktopWorkspaceSnapshot,
    serverDesktopWorkspaceSnapshot,
  );
  const [cameraReset, setCameraReset] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const hasTwin = Boolean(
    displayedManifest?.scene_asset_id && displayedSeries?.body_positions.length,
  );
  const taskDetailQuery = useQuery({
    queryKey: ["task-detail", displayedManifest?.task_key],
    queryFn: () =>
      api<TaskDetail>(`/tasks/${encodeURIComponent(displayedManifest?.task_key ?? "")}`),
    enabled: Boolean(displayedManifest?.task_key),
    staleTime: Infinity,
  });
  const taskDefinition = useMemo(
    () => (taskDetailQuery.data ? parseTaskDefinition(taskDetailQuery.data.bddl) : null),
    [taskDetailQuery.data],
  );
  const taskCueResolution = useMemo<TaskCueResolution | null>(() => {
    if (!hasTwin) return null;
    if (!displayedManifest?.task_key) {
      return { status: "unavailable", reason: "This replay has no task definition key" };
    }
    if (!taskDefinition) return null;
    if (taskDefinition.status === "unavailable") {
      return { status: "unavailable", reason: taskDefinition.reason };
    }
    return resolveTaskCues(taskDefinition.definition, displayedManifest.body_names);
  }, [displayedManifest, hasTwin, taskDefinition]);
  const taskCueBodies =
    taskCueResolution?.status === "resolved" ? taskCueResolution.bodies : EMPTY_TASK_CUE_BODIES;
  const [taskCuesEnabled, setTaskCuesEnabled] = useState(true);
  const sceneAssetId = displayedManifest?.scene_asset_id ?? null;
  const [sceneModelLoad, setSceneModelLoad] = useState<SceneModelLoadState | null>(null);
  const currentSceneModelLoad =
    sceneAssetId && sceneModelLoad?.assetId === sceneAssetId ? sceneModelLoad : null;
  const sceneModelPhase = sceneAssetId ? (currentSceneModelLoad?.phase ?? "loading") : null;
  const sceneAttempt = currentSceneModelLoad?.attempt ?? 0;
  const hasAgentviewCalibration = Boolean(
    displayedManifest?.scene_cameras.some(
      (camera) => camera.camera === "agentview" && camera.scope === "fixed_world",
    ),
  );
  const view = selectedView ?? (hasTwin ? "scene" : "trajectory");
  const cameraMode = selectedCameraMode ?? (hasAgentviewCalibration ? "front" : "oblique");
  const handleSceneReady = useCallback(() => {
    if (!sceneAssetId) return;
    setSceneModelLoad((current) => ({
      assetId: sceneAssetId,
      phase: "ready",
      attempt: current?.assetId === sceneAssetId ? current.attempt : 0,
      error: null,
    }));
  }, [sceneAssetId]);
  const handleSceneError = useCallback(
    (error: Error) => {
      if (!sceneAssetId) return;
      setSceneModelLoad((current) => ({
        assetId: sceneAssetId,
        phase: "error",
        attempt: current?.assetId === sceneAssetId ? current.attempt : 0,
        error,
      }));
    },
    [sceneAssetId],
  );
  const retrySceneModel = useCallback(() => {
    if (!sceneAssetId) return;
    useGLTF.clear(mediaUrl(sceneAssetId));
    setSceneModelLoad((current) => ({
      assetId: sceneAssetId,
      phase: "loading",
      attempt: (current?.assetId === sceneAssetId ? current.attempt : 0) + 1,
      error: null,
    }));
  }, [sceneAssetId]);
  useEffect(() => {
    if (displayedManifest) configure(displayedManifest.state_count - 1, displayedManifest.fps);
    return () => usePlayback.getState().reset();
  }, [displayedManifest, configure]);
  useEffect(() => {
    if (!workspaceReadyForRoute || canonicalReplayParamsString === serializedReplayParams) return;
    router.replace(replayHref(replayId, new URLSearchParams(canonicalReplayParamsString)), {
      scroll: false,
    });
  }, [
    canonicalReplayParamsString,
    replayId,
    router,
    serializedReplayParams,
    workspaceReadyForRoute,
  ]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest(
          "input, textarea, select, button, a, [contenteditable]:not([contenteditable='false'])",
        )
      ) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlaying();
      }
      if (event.code === "ArrowLeft") step(-1);
      if (event.code === "ArrowRight") step(1);
      const context = contextQuery.data;
      const targetId =
        event.key === "[" || event.code === "BracketLeft"
          ? context?.previous_replay_id
          : event.key === "]" || event.code === "BracketRight"
            ? context?.next_replay_id
            : null;
      if (targetId) {
        event.preventDefault();
        router.push(replayHref(targetId, new URLSearchParams(displayedReplayParamsString), true));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlaying, step, contextQuery.data, router, displayedReplayParamsString]);
  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === replayRootRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);
  const toggleFullscreen = async () => {
    const target = replayRootRef.current;
    if (!target) return;
    if (document.fullscreenElement === target) {
      await document.exitFullscreen();
      return;
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    await target.requestFullscreen();
  };
  if (workspaceQuery.isError) return <ErrorPanel error={workspaceQuery.error} />;
  if (!displayedManifest || !displayedSeries) return <ReplayWorkbenchSkeleton />;
  const manifest = displayedManifest;
  const series = displayedSeries;
  const videos = manifest.videos.filter(hasRecordedVideoDimensions);
  if (videos.length !== manifest.videos.length) {
    return (
      <ErrorPanel error={new Error("Recorded video dimensions are required for Replay layout.")} />
    );
  }
  const videoCount = videos.length;
  const maxVideoAspect = videoCount
    ? Math.max(...videos.map((video) => video.width / video.height))
    : 1;
  const cameraHeightFraction = videoCount ? maxVideoAspect / videoCount : 0;
  const cameraColumnWidth = videoCount
    ? `calc(${(cameraHeightFraction * 100).toFixed(6)}cqh + ${(2.75 - cameraHeightFraction * 2.5).toFixed(6)}rem - ${(cameraHeightFraction * Math.max(videoCount - 1, 0)).toFixed(6)}px)`
    : "0px";
  const stageStyle = {
    "--replay-camera-column-width": cameraColumnWidth,
    "--replay-video-count": String(Math.max(videoCount, 1)),
  } as CSSProperties;
  const currentSpeed = series.speed[Math.min(frame, series.speed.length - 1)];
  const currentJerk = series.jerk[Math.min(frame, series.jerk.length - 1)];
  const currentAction = frame < series.actions.length ? series.actions[frame] : undefined;
  const currentRotationVector = series.ee_axis_angle?.[frame];
  const recordingLabel =
    manifest.dataset_id === "original_libero"
      ? "Original LIBERO demo"
      : manifest.dataset_id === "lerobot_libero_plus"
        ? "LIBERO-Plus training record"
        : "Model rollout";
  const recordingNumber =
    manifest.dataset_id === "original_libero"
      ? `Demo ${manifest.episode_id + 1}`
      : manifest.dataset_id === "lerobot_libero_plus"
        ? `Dataset episode #${manifest.source_episode_id ?? manifest.episode_id}`
        : `Episode ${manifest.episode_id}`;
  const replayParams = new URLSearchParams(displayedReplayParamsString);
  const previousReplayId = contextQuery.data?.previous_replay_id;
  const nextReplayId = contextQuery.data?.next_replay_id;
  const currentContextItem = contextQuery.data?.items.find(
    (item) => item.replay_id === displayedReplayId,
  );
  const isReplayTransition = workspaceQuery.isPlaceholderData;
  const requestedReturn = safeReplayReturnPath(searchParams.get("return_to"));
  const defaultReturn =
    manifest.source === "dataset"
      ? `/data?dataset=${manifest.dataset_id ?? "original_libero"}&task=${encodeURIComponent(manifest.task_key ?? "")}`
      : "/data";
  const returnHref = requestedReturn ?? defaultReturn;
  const returnLabel = returnHref.startsWith("/evaluation")
    ? "Back to Evaluation"
    : returnHref.startsWith("/sources")
      ? "Back to Sources"
      : "Back to Recorded Data";

  const videoPanel = (
    <section
      className="replay-video-panel flex h-auto min-h-0 flex-col overflow-hidden border-r border-base-300 bg-black"
      data-testid="video-panel"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/15 bg-neutral px-3 text-neutral-content">
        <span className="flex items-center gap-2 text-xs font-semibold">
          <Video size={13} /> Synchronized cameras
        </span>
        <span className="mono text-xs text-neutral-content/80">
          {videos.length} view{videos.length === 1 ? "" : "s"}
        </span>
      </div>
      {videos.length ? (
        <div
          data-testid="video-viewport"
          className={cn(
            "replay-video-viewport grid min-h-0 flex-1 grid-cols-1 gap-px overflow-y-auto bg-white/15",
            videos.length > 1 ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          {videos.map((video) => (
            <SyncedVideo
              key={`${video.camera}-${video.asset_id}`}
              manifest={manifest}
              video={video}
              label={
                video.camera === "agentview"
                  ? "Front / agentview"
                  : video.camera === "robot0_eye_in_hand"
                    ? "Wrist / eye-in-hand"
                    : video.camera
              }
            />
          ))}
        </div>
      ) : (
        <div className="grid min-h-64 flex-1 place-items-center text-sm text-white/55">
          No recorded video
        </div>
      )}
    </section>
  );

  const spatialPanel = (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden bg-base-100"
      data-testid="spatial-panel"
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-base-300 px-2">
        <div
          role="tablist"
          aria-label="Spatial view"
          className="flex min-w-0 items-center gap-1"
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            const tabs = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="tab"]:not(:disabled)',
              ),
            );
            const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
            if (current < 0 || !tabs.length) return;
            event.preventDefault();
            const target =
              event.key === "Home"
                ? tabs[0]
                : event.key === "End"
                  ? tabs.at(-1)
                  : tabs[
                      (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length
                    ];
            target?.focus();
            target?.click();
          }}
        >
          {[
            { id: "trajectory", label: "Trajectory", icon: Rotate3D },
            { id: "scene", label: "Scene", icon: Layers3, disabled: !hasTwin },
            { id: "projection", label: "World XY / XZ", icon: Grid3X3 },
          ].map((item) => (
            <button
              type="button"
              role="tab"
              key={item.id}
              id={`spatial-tab-${item.id}`}
              aria-controls="spatial-view-panel"
              aria-selected={view === item.id}
              tabIndex={view === item.id ? 0 : -1}
              disabled={item.disabled}
              onClick={() => setSelectedView(item.id as typeof view)}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded px-2.5 text-xs font-semibold disabled:opacity-35",
                view === item.id
                  ? "bg-primary/12 text-primary"
                  : "text-base-content/60 hover:bg-base-200",
              )}
            >
              <item.icon size={14} /> {item.label}
            </button>
          ))}
        </div>
        {!hasTwin ? (
          <span className="ml-auto hidden items-center gap-1 text-xs text-base-content/55 2xl:flex">
            <Gauge size={12} /> EEF only
          </span>
        ) : null}
      </div>
      <div
        id="spatial-view-panel"
        role="tabpanel"
        aria-labelledby={`spatial-tab-${view}`}
        aria-busy={view === "scene" && hasTwin && sceneModelPhase === "loading"}
        data-testid="spatial-viewport"
        className="relative min-h-0 flex-1 bg-[var(--bg-raised)]"
      >
        {view === "projection" ? (
          <div className="absolute inset-0 p-2">
            <ProjectionChart series={series} frame={frame} />
          </div>
        ) : (
          <TrajectoryScene
            manifest={manifest}
            series={series}
            frame={frame}
            showTwin={view === "scene"}
            cameraMode={cameraMode}
            cameraReset={cameraReset}
            sceneAttempt={sceneAttempt}
            reducedMotion={reducedMotion}
            taskCueBodies={taskCueBodies}
            taskCuesEnabled={taskCuesEnabled}
            onSceneReady={handleSceneReady}
            onSceneError={handleSceneError}
          />
        )}
        {view === "scene" && hasTwin && sceneModelPhase === "loading" ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="scene-model-loading"
            className="pointer-events-none absolute right-3 top-3 z-20 flex items-center gap-2 border border-base-300 bg-base-100/90 px-3 py-2 text-xs font-semibold text-base-content shadow-sm backdrop-blur-sm"
          >
            <span aria-hidden className="loading loading-spinner loading-sm text-primary" />
            Loading robot and scene…
          </div>
        ) : null}
        {view === "scene" && hasTwin && sceneModelPhase === "error" ? (
          <div
            role="alert"
            data-testid="scene-model-error"
            className="absolute right-3 top-3 z-20 flex max-w-80 items-center gap-3 border border-error/30 bg-base-100/95 px-3 py-2 text-xs text-base-content shadow-sm backdrop-blur-sm"
          >
            <span className="min-w-0">
              <strong className="block font-semibold">Scene model failed to load.</strong>
              <span
                className="block truncate text-base-content/55"
                title={currentSceneModelLoad?.error?.message}
              >
                The trajectory is still available.
              </span>
            </span>
            <Button size="xs" variant="secondary" onClick={retrySceneModel}>
              <RotateCcw size={13} /> Retry
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-t border-base-300 px-2 py-1 text-xs text-base-content/55">
        <fieldset className="join">
          <legend className="sr-only">3D camera</legend>
          <Button
            size="xs"
            variant={cameraMode === "front" ? "primary" : "secondary"}
            className="join-item"
            disabled={!hasAgentviewCalibration || view === "projection"}
            title={
              hasAgentviewCalibration
                ? `${manifest.scene_fidelity === "recording_render_matched" ? "Recorded materials and lighting; " : ""}use the recorded agentview pose and vertical FOV`
                : "No exact agentview calibration is available"
            }
            onClick={() => {
              setSelectedCameraMode("front");
              setCameraReset((value) => value + 1);
            }}
          >
            <Camera size={13} /> Front sync
          </Button>
          <Button
            size="xs"
            variant={cameraMode === "oblique" ? "primary" : "secondary"}
            className="join-item"
            disabled={view === "projection"}
            title="Free-orbit oblique view"
            onClick={() => {
              setSelectedCameraMode("oblique");
              setCameraReset((value) => value + 1);
            }}
          >
            <RotateCcw size={13} /> Oblique
          </Button>
        </fieldset>
        {view === "scene" && hasTwin ? (
          taskCueResolution?.status === "resolved" ? (
            <Button
              size="xs"
              variant={taskCuesEnabled ? "primary" : "secondary"}
              aria-label="Task cues"
              aria-pressed={taskCuesEnabled}
              title="Toggle BDDL task-role highlights; details are available in Inspector"
              onClick={() => setTaskCuesEnabled((value) => !value)}
            >
              Task cues
            </Button>
          ) : taskDetailQuery.isError || taskCueResolution?.status === "unavailable" ? (
            <span
              className="text-[12px] text-warning"
              title={
                taskCueResolution?.status === "unavailable"
                  ? taskCueResolution.reason
                  : taskDetailQuery.error instanceof Error
                    ? taskDetailQuery.error.message
                    : "Task definition could not be loaded"
              }
            >
              Task cues unavailable
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[12px] text-base-content/55">
              <span aria-hidden className="loading loading-spinner loading-xs" />
              Loading task cues…
            </span>
          )
        ) : null}
      </div>
    </section>
  );

  const stage = (
    <div
      className="replay-stage-container h-auto min-h-0 min-w-0 min-[1281px]:h-full"
      data-testid="replay-stage"
    >
      <div
        data-testid="replay-media-layout"
        data-has-video={videoCount ? "true" : "false"}
        className="replay-media-layout grid h-auto min-h-0 min-w-0 overflow-hidden border border-base-300 min-[1281px]:h-full"
        style={stageStyle}
      >
        {videoCount ? videoPanel : null}
        {spatialPanel}
      </div>
    </div>
  );

  const timeline = (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden border border-base-300 bg-base-100"
      data-testid="replay-timeline"
    >
      <div className="shrink-0 border-b border-base-300">
        <PlaybackControls manifest={manifest} />
      </div>
      <div className="grid shrink-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-base-300 px-3 py-1.5 text-xs">
        <span>
          <span className="text-base-content/45">EEF speed</span>{" "}
          <strong className="mono ml-1">{fixed(currentSpeed, 3)} m/s</strong>
        </span>
        <span>
          <span className="text-base-content/45">EEF jerk</span>{" "}
          <strong className="mono ml-1">{fixed(currentJerk, 2)}</strong>
        </span>
        <span className="min-w-0 truncate">
          <span className="text-base-content/45">Action</span>{" "}
          <span className="mono ml-1">
            [{currentAction?.map((value) => fixed(value, 3)).join(", ") ?? "terminal state"}]
          </span>
        </span>
        {manifest.action_horizon ? (
          <Badge tone="cyan">horizon {manifest.action_horizon}</Badge>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 px-2 py-1" data-testid="replay-action-plot">
        <div className="relative h-full min-h-0">
          <TimeseriesChart
            series={series}
            frame={frame}
            fps={manifest.fps}
            maxFrame={manifest.state_count - 1}
          />
          <div
            className="pointer-events-none absolute bottom-[30px] left-12 right-[18px] top-[42px]"
            data-testid="replay-plot-domain"
          >
            <span
              className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-[#b85b45]"
              data-testid="replay-plot-playhead"
              style={{
                left: `${manifest.state_count > 1 ? (frame / (manifest.state_count - 1)) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );

  const inspector = (
    <aside
      aria-label="Replay inspector"
      className="flex h-full min-h-0 flex-col overflow-hidden border-l border-base-300 bg-base-100"
      data-testid="replay-inspector"
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-base-300 px-3">
        <span className="text-xs font-semibold">Inspector</span>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Hide inspector"
          onClick={() => setInspectorOpen(false)}
        >
          <PanelRightClose size={15} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b border-base-300 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">
            Record
          </h2>
          <dl className="mt-2 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 text-xs">
            <dt className="text-base-content/45">Type</dt>
            <dd>{recordingLabel}</dd>
            <dt className="text-base-content/45">Record</dt>
            <dd className="mono truncate" title={recordingNumber}>
              {recordingNumber}
            </dd>
            <dt className="text-base-content/45">Replay ID</dt>
            <dd className="mono truncate" title={manifest.replay_id}>
              {manifest.replay_id}
            </dd>
            {manifest.init_index != null ? (
              <>
                <dt className="text-base-content/45">Init index</dt>
                <dd className="mono">{manifest.init_index}</dd>
              </>
            ) : null}
            <dt className="text-base-content/45">Frames</dt>
            <dd className="mono">{manifest.state_count.toLocaleString("en-US")}</dd>
            <dt className="text-base-content/45">FPS</dt>
            <dd className="mono">{manifest.fps}</dd>
            <dt className="text-base-content/45">Duration</dt>
            <dd className="mono">{formatDuration((manifest.state_count - 1) / manifest.fps)}</dd>
          </dl>
        </section>
        {manifest.task_key ? (
          taskDetailQuery.isError ? (
            <section className="border-b border-base-300 p-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">
                Task definition (BDDL)
              </h2>
              <div
                role="alert"
                className="alert alert-warning alert-soft mt-2 block rounded p-2 text-xs"
              >
                Task definition could not be loaded.
              </div>
            </section>
          ) : taskDetailQuery.data && taskDefinition ? (
            <TaskDefinitionInspector
              detail={taskDetailQuery.data}
              parsed={taskDefinition}
              cueResolution={taskCueResolution}
              sourceTask={manifest.dataset_id === "lerobot_libero_plus"}
              taskCuesEnabled={taskCuesEnabled}
            />
          ) : (
            <section className="border-b border-base-300 p-3" aria-label="Loading task definition">
              <span className="inline-flex items-center gap-2 text-xs text-base-content/55">
                <span aria-hidden className="loading loading-spinner loading-xs" />
                Loading task definition…
              </span>
            </section>
          )
        ) : (
          <section className="border-b border-base-300 p-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">
              Task definition (BDDL)
            </h2>
            <p className="mt-2 text-xs leading-5 text-base-content/55">
              This replay has no task definition key.
            </p>
          </section>
        )}
        <section className="border-b border-base-300 p-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">
            Current frame
          </h2>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-base-content/45">Frame</dt>
              <dd className="mono mt-0.5 text-sm font-semibold">
                {frame} / {manifest.state_count - 1}
              </dd>
            </div>
            <div>
              <dt className="text-base-content/45">Time</dt>
              <dd className="mono mt-0.5 text-sm font-semibold">
                {formatDuration(frame / manifest.fps)}
              </dd>
            </div>
            <div>
              <dt className="text-base-content/45">EEF speed</dt>
              <dd className="mono mt-0.5">{fixed(currentSpeed, 3)} m/s</dd>
            </div>
            <div>
              <dt className="text-base-content/45">EEF jerk</dt>
              <dd className="mono mt-0.5">{fixed(currentJerk, 2)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-base-content/45">Rotation vector [rad]</dt>
              <dd className="mono mt-0.5 break-all" data-testid="current-rotation-vector">
                {rotationVectorQuaternion(currentRotationVector)
                  ? `[${currentRotationVector?.map((value) => fixed(value, 4)).join(", ")}]`
                  : "Not recorded"}
              </dd>
            </div>
          </dl>
        </section>
        {currentContextItem?.training_environment_category === "language" &&
        currentContextItem.training_instruction &&
        manifest.task_key ? (
          <section className="p-3">
            <EvaluationLanguageCandidates
              baseTaskKey={manifest.task_key}
              originalInstruction={
                currentContextItem.original_task_instruction ?? manifest.task_name
              }
              storedInstruction={currentContextItem.training_instruction}
            />
          </section>
        ) : null}
      </div>
    </aside>
  );

  const commandBar = (
    <header
      className="flex h-12 shrink-0 items-center gap-2 border border-base-300 bg-base-100 px-2"
      data-testid="replay-command-bar"
    >
      <Button size="sm" variant="secondary" asChild>
        <Link href={returnHref}>
          <ArrowLeft size={15} /> {returnLabel}
        </Link>
      </Button>
      <span aria-hidden className="h-5 border-l border-base-300" />
      <IconButton
        variant={browserOpen ? "ghost" : "secondary"}
        aria-label={browserOpen ? "Hide record browser" : "Show record browser"}
        aria-pressed={browserOpen}
        className="hidden xl:inline-flex"
        onClick={() => setBrowserOpen((value) => !value)}
      >
        {browserOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
      </IconButton>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone={manifest.source === "dataset" ? "green" : "cyan"}>{recordingLabel}</Badge>
          <Badge
            tone={
              hasTwin
                ? manifest.scene_fidelity === "recording_render_matched"
                  ? "green"
                  : "violet"
                : "neutral"
            }
          >
            <Layers3 size={11} />
            {hasTwin
              ? manifest.scene_fidelity === "recording_render_matched"
                ? "MuJoCo-matched 3D"
                : "Approximate 3D"
              : "EEF trajectory only"}
          </Badge>
          <h1 className="truncate text-sm font-semibold" title={manifest.task_name}>
            {manifest.task_name}
          </h1>
          <span className="mono hidden truncate text-xs text-base-content/50 2xl:inline">
            {recordingNumber}
          </span>
        </div>
      </div>
      {isReplayTransition ? (
        <span
          role="status"
          aria-live="polite"
          data-testid="replay-transition-loading"
          className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-base-content/55"
        >
          <span aria-hidden className="loading loading-spinner loading-xs text-primary/65" />
          <span className="hidden 2xl:inline">Loading record…</span>
          <span className="sr-only 2xl:hidden">Loading record</span>
        </span>
      ) : null}
      {previousReplayId ? (
        <IconButton size="sm" variant="ghost" asChild aria-label="Previous record">
          <Link
            href={replayHref(previousReplayId, replayParams, true)}
            aria-label="Previous record"
            aria-keyshortcuts="["
            title="Previous record ([)"
          >
            <ChevronLeft size={16} />
          </Link>
        </IconButton>
      ) : (
        <IconButton variant="ghost" disabled aria-label="Previous record">
          <ChevronLeft size={16} />
        </IconButton>
      )}
      {nextReplayId ? (
        <IconButton size="sm" variant="ghost" asChild aria-label="Next record">
          <Link
            href={replayHref(nextReplayId, replayParams, true)}
            aria-label="Next record"
            aria-keyshortcuts="]"
            title="Next record (])"
          >
            <ChevronRight size={16} />
          </Link>
        </IconButton>
      ) : (
        <IconButton variant="ghost" disabled aria-label="Next record">
          <ChevronRight size={16} />
        </IconButton>
      )}
      <IconButton
        variant={timelineOpen ? "ghost" : "secondary"}
        aria-label={timelineOpen ? "Hide timeline" : "Show timeline"}
        aria-pressed={timelineOpen}
        onClick={() => setTimelineOpen((value) => !value)}
      >
        <Gauge size={15} />
      </IconButton>
      <IconButton
        variant={inspectorOpen ? "ghost" : "secondary"}
        aria-label={inspectorOpen ? "Hide inspector" : "Show inspector"}
        aria-pressed={inspectorOpen}
        className="hidden xl:inline-flex"
        onClick={() => setInspectorOpen((value) => !value)}
      >
        {inspectorOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
      </IconButton>
      <IconButton
        data-testid="replay-fullscreen-toggle"
        aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        aria-pressed={fullscreen}
        onClick={() => void toggleFullscreen()}
      >
        <Maximize2 size={15} />
      </IconButton>
    </header>
  );

  return (
    <div
      ref={replayRootRef}
      data-testid="replay-workbench"
      data-displayed-replay-id={displayedReplayId}
      data-fullscreen={fullscreen ? "true" : "false"}
      aria-busy={isReplayTransition}
      className={cn(
        "viewport-page flex min-h-0 flex-col gap-2",
        fullscreen && "h-screen max-h-screen bg-base-200 p-2",
      )}
    >
      <PlaybackTicker />
      {commandBar}
      {desktopWorkspace ? (
        <PanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
          id="replay-editor-layout"
          defaultLayout={{ browser: 18, workspace: 63, inspector: 19 }}
        >
          {browserOpen ? (
            <>
              <Panel id="browser" defaultSize="18%" minSize={260} maxSize={390}>
                <ReplayNavigator
                  replayId={displayedReplayId}
                  manifest={manifest}
                  context={contextQuery.data}
                  isLoading={contextQuery.isLoading}
                  error={contextQuery.error}
                />
              </Panel>
              <Separator className="group relative w-px bg-base-300">
                <span className="absolute inset-y-0 -left-1.5 w-3 cursor-col-resize group-hover:bg-primary/10" />
              </Separator>
            </>
          ) : null}
          <Panel id="workspace" defaultSize="63%" minSize={640}>
            <div className="h-full min-h-0" data-testid="replay-detail-pane">
              <PanelGroup
                orientation="vertical"
                className="h-full min-h-0"
                id="replay-workspace-layout"
                defaultLayout={{ stage: 60, timeline: 40 }}
              >
                <Panel id="stage" defaultSize={timelineOpen ? "60%" : "100%"} minSize={360}>
                  {stage}
                </Panel>
                {timelineOpen ? (
                  <>
                    <Separator className="group relative h-px bg-base-300">
                      <span className="absolute inset-x-0 -top-1.5 h-3 cursor-row-resize group-hover:bg-primary/10" />
                    </Separator>
                    <Panel id="timeline" defaultSize="40%" minSize={240}>
                      {timeline}
                    </Panel>
                  </>
                ) : null}
              </PanelGroup>
            </div>
          </Panel>
          {inspectorOpen ? (
            <>
              <Separator className="group relative w-px bg-base-300">
                <span className="absolute inset-y-0 -left-1.5 w-3 cursor-col-resize group-hover:bg-primary/10" />
              </Separator>
              <Panel id="inspector" defaultSize="19%" minSize={280} maxSize={420}>
                {inspector}
              </Panel>
            </>
          ) : null}
        </PanelGroup>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <ReplayNavigator
            replayId={displayedReplayId}
            manifest={manifest}
            context={contextQuery.data}
            isLoading={contextQuery.isLoading}
            error={contextQuery.error}
          />
          <div className="h-auto min-h-[32rem] shrink-0" data-testid="replay-detail-pane">
            {stage}
          </div>
          {timelineOpen ? <div className="h-96 shrink-0">{timeline}</div> : null}
          <div className="min-h-96 shrink-0">{inspector}</div>
        </div>
      )}
    </div>
  );
}
