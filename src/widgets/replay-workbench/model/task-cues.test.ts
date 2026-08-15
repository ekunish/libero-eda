import { describe, expect, it } from "vitest";
import {
  type BddlTaskDefinition,
  parseTaskDefinition,
  resolveTaskCues,
  taskCueReferences,
} from "./task-cues";

function bddl({
  language = "Move the task object",
  objects,
  fixtures = "main_table - table",
  regions = "",
  interest,
  init = "",
  goal,
}: {
  language?: string;
  objects: string;
  fixtures?: string;
  regions?: string;
  interest: string;
  init?: string;
  goal: string;
}): string {
  return `(define (problem test)
    (:domain robosuite)
    (:language ${language})
    (:regions ${regions})
    (:fixtures ${fixtures})
    (:objects ${objects})
    (:obj_of_interest ${interest})
    (:init ${init})
    (:goal ${goal})
  )`;
}

function definition(source: string): BddlTaskDefinition {
  const result = parseTaskDefinition(source);
  expect(result.status).toBe("parsed");
  if (result.status !== "parsed") throw new Error(result.reason);
  return result.definition;
}

describe("BDDL task definition", () => {
  it("parses every Inspector section without discarding numeric region constraints", () => {
    const result = parseTaskDefinition(
      bddl({
        language: "Pick up the black bowl and place it on the plate",
        fixtures: "main_table - table cabinet_1 - wooden_cabinet",
        objects: "bowl_1 bowl_2 - bowl plate_1 - plate",
        regions:
          "(plate_region (:target main_table) (:ranges ((0.05 0.19 0.07 0.21))) (:yaw_rotation ((2.6 2.7))))",
        interest: "bowl_1 plate_1",
        init: "(On bowl_1 main_table_plate_region) (Open cabinet_1)",
        goal: "(And (On bowl_1 plate_1))",
      }),
    );

    expect(result).toEqual({
      status: "parsed",
      definition: {
        problem: "test",
        domain: "robosuite",
        language: "Pick up the black bowl and place it on the plate",
        fixtures: [
          { name: "main_table", type: "table" },
          { name: "cabinet_1", type: "wooden_cabinet" },
        ],
        objects: [
          { name: "bowl_1", type: "bowl" },
          { name: "bowl_2", type: "bowl" },
          { name: "plate_1", type: "plate" },
        ],
        objectsOfInterest: ["bowl_1", "plate_1"],
        regions: [
          {
            name: "plate_region",
            qualifiedName: "main_table_plate_region",
            target: "main_table",
            ranges: [[0.05, 0.19, 0.07, 0.21]],
            yawRotations: [[2.6, 2.7]],
          },
        ],
        initialState: [
          { predicate: "on", references: ["bowl_1", "main_table_plate_region"] },
          { predicate: "open", references: ["cabinet_1"] },
        ],
        goals: [{ index: 0, predicate: "on", references: ["bowl_1", "plate_1"] }],
      },
    });
  });

  it("assigns manipulated and destination roles for an On goal", () => {
    const parsed = definition(
      bddl({
        objects: "bowl_1 - bowl plate_1 - plate",
        interest: "bowl_1 plate_1",
        goal: "(And (On bowl_1 plate_1))",
      }),
    );
    const result = resolveTaskCues(parsed, [
      "world",
      "robot0_link0",
      "bowl_1_main",
      "plate_1_main",
      "distractor_1_main",
    ]);
    expect(result).toEqual({
      status: "resolved",
      goals: [{ index: 0, predicate: "on", references: ["bowl_1", "plate_1"] }],
      references: [
        { reference: "bowl_1", roles: ["manipulated"] },
        { reference: "plate_1", roles: ["destination"] },
      ],
      bodies: [
        { bodyName: "bowl_1_main", roles: ["manipulated"] },
        { bodyName: "plate_1_main", roles: ["destination"] },
      ],
      unrenderedRegions: [],
    });
  });

  it("keeps every predicate and every role in a three-goal task", () => {
    const parsed = definition(
      bddl({
        fixtures: "main_table - table stove_1 - stove",
        objects: "pot_1 pot_2 - pot",
        regions: "(cook_region (:target stove_1))",
        interest: "pot_1 pot_2 stove_1_cook_region stove_1",
        goal: "(And (On pot_1 stove_1_cook_region) (On pot_2 stove_1_cook_region) (Turnon stove_1))",
      }),
    );
    expect(taskCueReferences(parsed)).toEqual([
      { reference: "pot_1", roles: ["manipulated"] },
      { reference: "pot_2", roles: ["manipulated"] },
      { reference: "stove_1", roles: ["manipulated"] },
      { reference: "stove_1_cook_region", roles: ["destination"] },
    ]);
    const result = resolveTaskCues(parsed, [
      "pot_1_main",
      "pot_2_main",
      "stove_1_main",
      "stove_1_button",
    ]);
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
    const parsed = definition(
      bddl({
        objects: "plate_1 - plate",
        regions: "(front_region (:target main_table))",
        interest: "plate_1",
        goal: "(And (On plate_1 main_table_front_region))",
      }),
    );
    const result = resolveTaskCues(parsed, ["table", "plate_1_main"]);
    expect(result).toEqual({
      status: "resolved",
      goals: [
        {
          index: 0,
          predicate: "on",
          references: ["plate_1", "main_table_front_region"],
        },
      ],
      references: [
        { reference: "main_table_front_region", roles: ["destination"] },
        { reference: "plate_1", roles: ["manipulated"] },
      ],
      bodies: [{ bodyName: "plate_1_main", roles: ["manipulated"] }],
      unrenderedRegions: ["main_table_front_region"],
    });
  });

  it("fails closed instead of returning a partial cue set", () => {
    const parsed = definition(
      bddl({
        objects: "bowl_1 - bowl plate_1 - plate",
        interest: "bowl_1 plate_1",
        goal: "(And (On bowl_1 plate_1))",
      }),
    );
    const result = resolveTaskCues(parsed, ["bowl_1_main"]);
    expect(result).toEqual({
      status: "unavailable",
      reason: "No MuJoCo body matches BDDL entity: plate_1",
    });
  });

  it("rejects unsupported goal predicates without returning a partial definition", () => {
    const result = parseTaskDefinition(
      bddl({
        objects: "bowl_1 - bowl",
        interest: "bowl_1",
        goal: "(And (Holding bowl_1))",
      }),
    );
    expect(result).toEqual({
      status: "unavailable",
      reason: "BDDL goal predicate is unsupported: holding",
    });
  });
});
