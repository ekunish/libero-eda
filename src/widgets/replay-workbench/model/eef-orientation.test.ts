import { describe, expect, it } from "vitest";
import { rotationVectorQuaternion } from "./eef-orientation";

describe("rotationVectorQuaternion", () => {
  it("maps a zero rotation vector to the identity quaternion", () => {
    expect(rotationVectorQuaternion([0, 0, 0])).toEqual([0, 0, 0, 1]);
  });

  it("maps an axis-angle rotation vector without converting to Euler angles", () => {
    const quaternion = rotationVectorQuaternion([0, 0, Math.PI]);
    expect(quaternion?.[0]).toBeCloseTo(0);
    expect(quaternion?.[1]).toBeCloseTo(0);
    expect(quaternion?.[2]).toBeCloseTo(1);
    expect(quaternion?.[3]).toBeCloseTo(0);
  });

  it("rejects missing, malformed, and non-finite vectors", () => {
    expect(rotationVectorQuaternion(undefined)).toBeNull();
    expect(rotationVectorQuaternion([0, 1])).toBeNull();
    expect(rotationVectorQuaternion([0, Number.NaN, 0])).toBeNull();
  });
});
