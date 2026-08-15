import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  aggregateAmbient,
  createMujocoCubeTexture,
  createMujocoPhongMaterial,
  mujocoCubeScale,
  parseMujocoMaterial,
  parseMujocoRenderContract,
  sourceSpecularScale,
} from "./mujoco-render";

const renderJson = {
  asset: {
    extras: {
      mujocoRender: {
        renderer: "mujoco_classic",
        color_space: "srgb_textures_linear_lighting",
        tone_mapping: "none",
        headlight: {
          active: true,
          ambient: [0.1, 0.2, 0.3],
          diffuse: [0.4, 0.4, 0.4],
          specular: [0.2, 0.2, 0.2],
        },
        lights: [
          {
            index: 0,
            name: "light1",
            type: "spot",
            mode: "fixed_world",
            position: [1, 1, 4],
            direction: [0, -0.15, -1],
            ambient: [0.05, 0.05, 0.05],
            diffuse: [0.8, 0.8, 0.8],
            specular: [0.3, 0.3, 0.3],
            attenuation: [1, 0, 0],
            cutoff_degrees: 45,
            exponent: 10,
            active: true,
            cast_shadow: false,
          },
        ],
        shadow_map_size: 4096,
        skybox: null,
      },
    },
  },
};

const classic = {
  rgba: [0.2, 0.3, 0.4, 1] as [number, number, number, number],
  emission: 0.1,
  specular: 0.6,
  shininess: 0.75,
  reflectance: 0.2,
  texuniform: false,
  texture_type: 0 as const,
  texture_repeat: [2, 3] as [number, number],
};

describe("MuJoCo render contract", () => {
  it("parses source lights and preserves disabled shadows", () => {
    const render = parseMujocoRenderContract(renderJson);
    expect(render.lights[0]?.cast_shadow).toBe(false);
    expect(render.lights[0]?.position).toEqual([1, 1, 4]);
    expect(aggregateAmbient(render).toArray()).toEqual([
      expect.closeTo(0.15),
      expect.closeTo(0.25),
      expect.closeTo(0.35),
    ]);
    expect(sourceSpecularScale(render)).toBeCloseTo(0.5 / 1.2);
  });

  it("rejects Scene v3 without the source render contract", () => {
    expect(() => parseMujocoRenderContract({ asset: {} })).toThrow("rendering contract");
  });

  it("rejects an invalid skybox instead of dropping it", () => {
    const invalid = {
      asset: {
        extras: {
          mujocoRender: {
            ...renderJson.asset.extras.mujocoRender,
            skybox: {
              texture: -1,
              layout: "vertical_R_L_U_D_F_B",
              face_size: 256,
            },
          },
        },
      },
    };
    expect(() => parseMujocoRenderContract(invalid)).toThrow("rendering contract");
  });

  it("rejects source attenuation that Three cannot reproduce exactly", () => {
    const invalid = structuredClone(renderJson);
    const firstLight = invalid.asset.extras.mujocoRender.lights.at(0);
    expect(firstLight).toBeDefined();
    if (!firstLight) {
      throw new Error("The test fixture has no light");
    }
    firstLight.attenuation = [1, 0.1, 0];
    expect(() => parseMujocoRenderContract(invalid)).toThrow("Invalid MuJoCo light");
  });

  it("replaces arbitrary PBR with a source Phong material", () => {
    const source = new THREE.MeshStandardMaterial();
    source.userData.mujocoMaterial = classic;
    const parsed = parseMujocoMaterial(source);
    const material = createMujocoPhongMaterial(
      source,
      parsed,
      parseMujocoRenderContract(renderJson),
    );
    expect(material).toBeInstanceOf(THREE.MeshPhongMaterial);
    expect(material.shininess).toBe(96);
    expect(material.emissiveIntensity).toBe(0.1);
    expect(material.userData.parcMujocoConverted).toBe(true);
  });

  it("rejects a material without raw MuJoCo values", () => {
    expect(() => parseMujocoMaterial(new THREE.MeshStandardMaterial())).toThrow(
      "Invalid MuJoCo material",
    );
  });

  it("uses unit primitive coordinates for non-uniform cube mapping", () => {
    expect(mujocoCubeScale(6, [4, 2, 0.5], false).toArray()).toEqual([0.25, 0.5, 2]);
    expect(mujocoCubeScale(6, [4, 2, 0.5], true).toArray()).toEqual([1, 1, 1]);
  });

  it("turns a single MuJoCo cube image into six GPU faces", () => {
    const source = new THREE.Texture();
    source.image = { width: 4, height: 4 } as CanvasImageSource;

    const cube = createMujocoCubeTexture(source);

    expect(cube.images).toHaveLength(6);
    expect(new Set(cube.images).size).toBe(1);
    expect(cube.colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it("injects object-space cube sampling into the Phong shader", () => {
    const material = createMujocoPhongMaterial(
      new THREE.MeshStandardMaterial(),
      { ...classic, texture_type: 1 },
      parseMujocoRenderContract(renderJson),
      {
        texture: new THREE.CubeTexture(),
        scale: new THREE.Vector3(0.25, 0.5, 2),
      },
    );
    const shader = {
      uniforms: {},
      vertexShader: "#include <common>\n#include <begin_vertex>",
      fragmentShader: "#include <common>\n#include <map_fragment>",
    } as unknown as THREE.WebGLProgramParametersWithUniforms;

    material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);

    expect(shader.vertexShader).toContain("vParcMujocoCubeCoord = position");
    expect(shader.fragmentShader).toContain("textureCube( parcMujocoCubeMap");
    expect(shader.uniforms.parcMujocoCubeScale?.value.toArray()).toEqual([0.25, 0.5, 2]);
  });
});
