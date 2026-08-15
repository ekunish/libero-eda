import { describe, expect, it } from "vitest";
import { resolveTaskCues } from "./task-cues";

function bddl({
  objects,
  fixtures = "main_table - table",
  regions = "",
  interest,
  goal,
}: {
  objects: string;
  fixtures?: string;
  regions?: string;
  interest: string;
  goal: string;
}): string {
  return `(define (problem test)
    (:domain robosuite)
    (:regions ${regions})
    (:fixtures ${fixtures})
    (:objects ${objects})
    (:obj_of_interest ${interest})
    (:init)
    (:goal ${goal})
  )`;
}

describe("resolveTaskCues", () => {
  it("assigns manipulated and destination roles for an On goal", () => {
    const result = resolveTaskCues(
      bddl({
        objects: "bowl_1 - bowl plate_1 - plate",
        interest: "bowl_1 plate_1",
        goal: "(And (On bowl_1 plate_1))",
      }),
      ["world", "robot0_link0", "bowl_1_main", "plate_1_main", "distractor_1_main"],
    );
    expect(result).toEqual({
      status: "resolved",
      goals: [{ index: 0, predicate: "on", references: ["bowl_1", "plate_1"] }],
      bodies: [
        { bodyName: "bowl_1_main", roles: ["manipulated"] },
        { bodyName: "plate_1_main", roles: ["destination"] },
      ],
      unrenderedRegions: [],
    });
  });

  it("keeps every predicate and every role in a three-goal task", () => {
    const result = resolveTaskCues(
      bddl({
        fixtures: "main_table - table stove_1 - stove",
        objects: "pot_1 pot_2 - pot",
        regions: "(cook_region (:target stove_1))",
        interest: "pot_1 pot_2 stove_1_cook_region stove_1",
        goal: "(And (On pot_1 stove_1_cook_region) (On pot_2 stove_1_cook_region) (Turnon stove_1))",
      }),
      ["pot_1_main", "pot_2_main", "stove_1_main", "stove_1_button"],
    );
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.goals).toHaveLength(3);
    expect(result.bodies).toEqual([
      { bodyName: "pot_1_main", roles: ["manipulated"] },
      { bodyName: "pot_2_main", roles: ["manipulated"] },
      { bodyName: "stove_1_button", roles: ["destination", "manipulated"] },
      { bodyName: "stove_1_main", roles: ["destination", "manipulated"] },
    ]);
  });

  it("does not turn the whole table into a destination marker for an abstract region", () => {
    const result = resolveTaskCues(
      bddl({
        objects: "plate_1 - plate",
        regions: "(front_region (:target main_table))",
        interest: "plate_1",
        goal: "(And (On plate_1 main_table_front_region))",
      }),
      ["table", "plate_1_main"],
    );
    expect(result).toEqual({
      status: "resolved",
      goals: [
        {
          index: 0,
          predicate: "on",
          references: ["plate_1", "main_table_front_region"],
        },
      ],
      bodies: [{ bodyName: "plate_1_main", roles: ["manipulated"] }],
      unrenderedRegions: ["main_table_front_region"],
    });
  });

  it("fails closed instead of returning a partial cue set", () => {
    const result = resolveTaskCues(
      bddl({
        objects: "bowl_1 - bowl plate_1 - plate",
        interest: "bowl_1 plate_1",
        goal: "(And (On bowl_1 plate_1))",
      }),
      ["bowl_1_main"],
    );
    expect(result).toEqual({
      status: "unavailable",
      reason: "No MuJoCo body matches BDDL entity: plate_1",
    });
  });

  it("rejects unsupported goal predicates", () => {
    const result = resolveTaskCues(
      bddl({
        objects: "bowl_1 - bowl",
        interest: "bowl_1",
        goal: "(And (Holding bowl_1))",
      }),
      ["bowl_1_main"],
    );
    expect(result).toEqual({
      status: "unavailable",
      reason: "BDDL goal predicate is unsupported: Holding",
    });
  });
});
