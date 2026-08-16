import * as THREE from "three";

export type MujocoClassicMaterial = {
  rgba: [number, number, number, number];
  emission: number;
  specular: number;
  shininess: number;
  reflectance: number;
  texuniform: boolean;
  texture_type: 0 | 1 | null;
  texture_repeat: [number, number];
};

export type MujocoLight = {
  index: number;
  name: string;
  type: "spot" | "directional" | "point";
  mode: "fixed_world";
  position: [number, number, number];
  direction: [number, number, number];
  ambient: [number, number, number];
  diffuse: [number, number, number];
  specular: [number, number, number];
  attenuation: [number, number, number];
  cutoff_degrees: number;
  exponent: number;
  active: boolean;
  cast_shadow: boolean;
};

export type MujocoRenderContract = {
  renderer: "mujoco_classic";
  color_space: "srgb_textures_linear_lighting";
  tone_mapping: "none";
  headlight: {
    active: boolean;
    ambient: [number, number, number];
    diffuse: [number, number, number];
    specular: [number, number, number];
  };
  lights: MujocoLight[];
  shadow_map_size: number;
  skybox: {
    texture: number;
    layout: "vertical_R_L_U_D_F_B";
    face_size: number;
  } | null;
};

type GltfJson = {
  asset?: { extras?: { mujocoRender?: unknown } };
};

function finiteVector(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

export function parseMujocoRenderContract(json: unknown): MujocoRenderContract {
  const render = (json as GltfJson | undefined)?.asset?.extras?.mujocoRender as
    | Partial<MujocoRenderContract>
    | undefined;
  if (
    render?.renderer !== "mujoco_classic" ||
    render.color_space !== "srgb_textures_linear_lighting" ||
    render.tone_mapping !== "none" ||
    !Number.isInteger(render.shadow_map_size) ||
    (render.shadow_map_size ?? 0) < 1 ||
    !render.headlight ||
    typeof render.headlight.active !== "boolean" ||
    !finiteVector(render.headlight.ambient, 3) ||
    !finiteVector(render.headlight.diffuse, 3) ||
    !finiteVector(render.headlight.specular, 3) ||
    !Array.isArray(render.lights) ||
    !(
      render.skybox === null ||
      (render.skybox?.layout === "vertical_R_L_U_D_F_B" &&
        Number.isInteger(render.skybox.texture) &&
        render.skybox.texture >= 0 &&
        Number.isInteger(render.skybox.face_size) &&
        render.skybox.face_size > 0)
    )
  ) {
    throw new Error("Scene v3 MuJoCo rendering contract is missing");
  }
  for (const [index, light] of render.lights.entries()) {
    if (
      light.index !== index ||
      typeof light.name !== "string" ||
      light.name.length === 0 ||
      !["spot", "directional", "point"].includes(light.type) ||
      light.mode !== "fixed_world" ||
      typeof light.active !== "boolean" ||
      typeof light.cast_shadow !== "boolean" ||
      !finiteVector(light.position, 3) ||
      !finiteVector(light.direction, 3) ||
      !finiteVector(light.ambient, 3) ||
      !finiteVector(light.diffuse, 3) ||
      !finiteVector(light.specular, 3) ||
      !finiteVector(light.attenuation, 3) ||
      light.attenuation.some((value) => value < 0) ||
      light.attenuation.some(
        (value, component) => Math.abs(value - (component === 0 ? 1 : 0)) > 1e-6,
      ) ||
      !Number.isFinite(light.cutoff_degrees) ||
      light.cutoff_degrees < 0 ||
      light.cutoff_degrees > 90 ||
      !Number.isFinite(light.exponent) ||
      light.exponent < 0 ||
      light.exponent > 128
    ) {
      throw new Error(`Invalid MuJoCo light in Scene v3: ${index}`);
    }
  }
  return render as MujocoRenderContract;
}

export function parseMujocoMaterial(material: THREE.Material): MujocoClassicMaterial {
  const value = material.userData.mujocoMaterial as Partial<MujocoClassicMaterial> | undefined;
  if (
    !value ||
    !finiteVector(value.rgba, 4) ||
    !finiteVector(value.texture_repeat, 2) ||
    value.texture_repeat.some((item) => item <= 0) ||
    ![null, 0, 1].includes(value.texture_type ?? null) ||
    typeof value.texuniform !== "boolean" ||
    value.rgba.some((item) => item < 0 || item > 1) ||
    ![value.emission, value.specular, value.shininess, value.reflectance].every(
      (item) => typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 1,
    )
  ) {
    throw new Error(`Invalid MuJoCo material in Scene v3: ${material.name}`);
  }
  return value as MujocoClassicMaterial;
}

function luminance(color: [number, number, number]): number {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

export function sourceSpecularScale(render: MujocoRenderContract): number {
  let diffuse = render.headlight.active ? luminance(render.headlight.diffuse) : 0;
  let specular = render.headlight.active ? luminance(render.headlight.specular) : 0;
  for (const light of render.lights) {
    if (!light.active) continue;
    diffuse += luminance(light.diffuse);
    specular += luminance(light.specular);
  }
  return diffuse > 1e-6 ? THREE.MathUtils.clamp(specular / diffuse, 0, 2) : 1;
}

export function configureMujocoMappedTexture(texture: THREE.Texture): THREE.Texture {
  // Scene v3 geometry already stores glTF-oriented UVs. TextureLoader defaults
  // to flipY=true for standalone images, which would undo that conversion.
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function createMujocoPhongMaterial(
  source: THREE.Material,
  classic: MujocoClassicMaterial,
  render: MujocoRenderContract,
  cubeMapping?: { texture: THREE.CubeTexture; scale: THREE.Vector3 },
): THREE.MeshPhongMaterial {
  const sourceWithMap = source as THREE.Material & { map?: THREE.Texture | null };
  const map = cubeMapping ? null : (sourceWithMap.map ?? null);
  if (map) configureMujocoMappedTexture(map);
  const color = new THREE.Color(classic.rgba[0], classic.rgba[1], classic.rgba[2]);
  const material = new THREE.MeshPhongMaterial({
    name: source.name,
    color,
    map,
    emissive: color,
    emissiveIntensity: classic.emission,
    specular: new THREE.Color().setScalar(
      THREE.MathUtils.clamp(classic.specular * sourceSpecularScale(render), 0, 1),
    ),
    shininess: Math.max(1, classic.shininess * 128),
    opacity: classic.rgba[3],
    transparent: classic.rgba[3] < 0.999,
    depthWrite: classic.rgba[3] >= 0.999,
    side: THREE.DoubleSide,
  });
  material.userData = structuredClone(source.userData);
  material.userData.parcMujocoConverted = true;
  if (cubeMapping) {
    material.userData.parcMujocoCubeMapped = true;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.parcMujocoCubeMap = { value: cubeMapping.texture };
      shader.uniforms.parcMujocoCubeScale = { value: cubeMapping.scale };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
uniform vec3 parcMujocoCubeScale;
varying vec3 vParcMujocoCubeCoord;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vParcMujocoCubeCoord = position * parcMujocoCubeScale;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
uniform samplerCube parcMujocoCubeMap;
varying vec3 vParcMujocoCubeCoord;`,
        )
        .replace(
          "#include <map_fragment>",
          "diffuseColor *= textureCube( parcMujocoCubeMap, vParcMujocoCubeCoord );",
        );
    };
    material.customProgramCacheKey = () => "parc-mujoco-object-space-cube-v1";
  }
  return material;
}

function renderSize(geomType: number, size: [number, number, number]): THREE.Vector3 {
  if (geomType === 2) return new THREE.Vector3(size[0], size[0], size[0]);
  if (geomType === 3) return new THREE.Vector3(size[0], size[0], size[1] + size[0]);
  if (geomType === 5) return new THREE.Vector3(size[0], size[0], size[1]);
  return new THREE.Vector3(...size);
}

export function mujocoCubeScale(
  geomType: number,
  size: [number, number, number],
  texuniform: boolean,
): THREE.Vector3 {
  const builtIn = [2, 3, 4, 5, 6].includes(geomType);
  const scale = renderSize(geomType, size);
  if (builtIn) {
    if (scale.toArray().some((value) => !Number.isFinite(value) || value <= 0)) {
      throw new Error(`Invalid primitive dimensions for a Scene v3 cube texture: ${geomType}`);
    }
    return texuniform
      ? new THREE.Vector3(1, 1, 1)
      : scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
  }
  if (texuniform) {
    if (scale.toArray().some((value) => !Number.isFinite(value))) {
      throw new Error(`Invalid geometry dimensions for a Scene v3 cube texture: ${geomType}`);
    }
    return scale;
  }
  return new THREE.Vector3(1, 1, 1);
}

function imageSize(image: CanvasImageSource): [number, number] {
  const sized = image as CanvasImageSource & { width?: number; height?: number };
  const width = Number(sized.width);
  const height = Number(sized.height);
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error("Could not read Scene v3 cube-texture image dimensions");
  }
  return [width, height];
}

export function createMujocoCubeTexture(source: THREE.Texture): THREE.CubeTexture {
  const image = source.image as CanvasImageSource | undefined;
  if (!image) throw new Error("Scene v3 cube-texture image is missing");
  const [width, height] = imageSize(image);
  let faces: CanvasImageSource[];
  if (height === width) {
    faces = Array.from({ length: 6 }, () => image);
  } else if (height === width * 6) {
    faces = Array.from({ length: 6 }, (_, index) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = width;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not create the Scene v3 cube-texture canvas");
      context.drawImage(image, 0, index * width, width, width, 0, 0, width, width);
      return canvas;
    });
  } else {
    throw new Error(`Invalid Scene v3 cube-texture layout: ${width}x${height}`);
  }
  const cube = new THREE.CubeTexture(faces);
  cube.colorSpace = THREE.SRGBColorSpace;
  cube.needsUpdate = true;
  return cube;
}

export function aggregateAmbient(render: MujocoRenderContract): THREE.Color {
  const value: [number, number, number] = render.headlight.active
    ? [...render.headlight.ambient]
    : [0, 0, 0];
  for (const light of render.lights) {
    if (!light.active) continue;
    value[0] += light.ambient[0];
    value[1] += light.ambient[1];
    value[2] += light.ambient[2];
  }
  return new THREE.Color(value[0], value[1], value[2]);
}
