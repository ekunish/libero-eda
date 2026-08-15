export type TaskCueRole = "manipulated" | "destination";

export type TaskCueGoal = {
  index: number;
  predicate: "on" | "in" | "open" | "close" | "turnon" | "turnoff";
  references: string[];
};

export type TaskCueBody = {
  bodyName: string;
  roles: TaskCueRole[];
};

export type TaskCueResolution =
  | {
      status: "resolved";
      goals: TaskCueGoal[];
      bodies: TaskCueBody[];
      unrenderedRegions: string[];
    }
  | { status: "unavailable"; reason: string };

type SExpression = string | SExpression[];

const supportedPredicates = new Set(["on", "in", "open", "close", "turnon", "turnoff"]);

function tokenizeBddl(bddl: string): string[] {
  const withoutComments = bddl.replace(/;[^\n\r]*/g, "");
  return withoutComments.match(/\(|\)|[^\s()]+/g) ?? [];
}

function parseBddl(bddl: string): SExpression {
  const tokens = tokenizeBddl(bddl);
  let cursor = 0;

  function parseOne(): SExpression {
    const token = tokens[cursor++];
    if (!token) throw new Error("BDDL ended before its expression was complete");
    if (token === ")") throw new Error("BDDL contains an unmatched closing parenthesis");
    if (token !== "(") return token;
    const expression: SExpression[] = [];
    while (tokens[cursor] !== ")") {
      if (cursor >= tokens.length) throw new Error("BDDL contains an unclosed expression");
      expression.push(parseOne());
    }
    cursor += 1;
    return expression;
  }

  const root = parseOne();
  if (cursor !== tokens.length) throw new Error("BDDL contains more than one root expression");
  return root;
}

function section(root: SExpression, name: string): SExpression[] | null {
  if (!Array.isArray(root)) return null;
  if (typeof root[0] === "string" && root[0].toLowerCase() === name) return root;
  for (const child of root) {
    const match = section(child, name);
    if (match) return match;
  }
  return null;
}

function strings(expression: SExpression[]): string[] {
  return expression.filter((item): item is string => typeof item === "string");
}

function declaredEntities(root: SExpression): Map<string, string> {
  const entities = new Map<string, string>();
  for (const sectionName of [":fixtures", ":objects"]) {
    const declaration = section(root, sectionName);
    if (!declaration) throw new Error(`BDDL is missing ${sectionName}`);
    const tokens = strings(declaration.slice(1));
    let pending: string[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (!token) throw new Error(`BDDL contains an invalid ${sectionName} token`);
      if (token === "-") {
        const entityType = tokens[index + 1];
        if (!pending.length || !entityType) {
          throw new Error(`BDDL contains an invalid ${sectionName} declaration`);
        }
        for (const entity of pending) entities.set(entity, entityType);
        pending = [];
        index += 1;
      } else {
        pending.push(token);
      }
    }
    if (pending.length) throw new Error(`BDDL contains an untyped ${sectionName} declaration`);
  }
  return entities;
}

function regionTargets(root: SExpression): Map<string, string> {
  const regions = section(root, ":regions");
  if (!regions) throw new Error("BDDL is missing :regions");
  const result = new Map<string, string>();
  for (const item of regions.slice(1)) {
    if (!Array.isArray(item) || typeof item[0] !== "string") continue;
    const target = section(item, ":target");
    const targetName = target && typeof target[1] === "string" ? target[1] : null;
    if (!targetName) throw new Error(`BDDL region ${item[0]} is missing its :target`);
    const qualifiedName = `${targetName}_${item[0]}`;
    if (result.has(qualifiedName)) throw new Error(`BDDL region is duplicated: ${qualifiedName}`);
    result.set(qualifiedName, targetName);
  }
  return result;
}

function goalPredicates(root: SExpression): TaskCueGoal[] {
  const goal = section(root, ":goal");
  if (!goal?.[1]) throw new Error("BDDL is missing :goal");
  const result: TaskCueGoal[] = [];

  function visit(expression: SExpression): void {
    if (!Array.isArray(expression) || typeof expression[0] !== "string") {
      throw new Error("BDDL goal contains an invalid expression");
    }
    const predicate = expression[0].toLowerCase();
    if (predicate === "and") {
      for (const child of expression.slice(1)) visit(child);
      return;
    }
    if (!supportedPredicates.has(predicate)) {
      throw new Error(`BDDL goal predicate is unsupported: ${expression[0]}`);
    }
    const references = expression.slice(1);
    if (!references.every((item): item is string => typeof item === "string")) {
      throw new Error(`BDDL goal predicate ${expression[0]} contains a nested argument`);
    }
    const expectedArguments = predicate === "on" || predicate === "in" ? 2 : 1;
    if (references.length !== expectedArguments) {
      throw new Error(
        `BDDL goal predicate ${expression[0]} expects ${expectedArguments} arguments`,
      );
    }
    result.push({
      index: result.length,
      predicate: predicate as TaskCueGoal["predicate"],
      references,
    });
  }

  visit(goal[1]);
  if (!result.length) throw new Error("BDDL goal contains no supported predicate");
  return result;
}

function matchingBodies(entity: string, bodyNames: readonly string[]): string[] {
  return bodyNames.filter((bodyName) => bodyName === entity || bodyName.startsWith(`${entity}_`));
}

export function resolveTaskCues(bddl: string, bodyNames: readonly string[]): TaskCueResolution {
  try {
    const root = parseBddl(bddl);
    const entities = declaredEntities(root);
    const regions = regionTargets(root);
    const interest = section(root, ":obj_of_interest");
    if (!interest) throw new Error("BDDL is missing :obj_of_interest");
    const interestReferences = new Set(strings(interest.slice(1)));
    if (!interestReferences.size) throw new Error("BDDL :obj_of_interest is empty");
    const goals = goalPredicates(root);
    const rolesByBody = new Map<string, Set<TaskCueRole>>();
    const unrenderedRegions = new Set<string>();

    const applyRole = (reference: string, role: TaskCueRole): void => {
      const regionTarget = regions.get(reference);
      const entity = entities.has(reference) ? reference : regionTarget;
      if (!entity) throw new Error(`BDDL goal reference cannot be resolved: ${reference}`);
      const regionTargetType = regionTarget ? entities.get(regionTarget) : undefined;
      if (regionTargetType === "table" || regionTargetType?.endsWith("_table")) {
        unrenderedRegions.add(reference);
        return;
      }
      if (!interestReferences.has(reference) && !interestReferences.has(entity)) {
        throw new Error(`BDDL goal reference is not declared in :obj_of_interest: ${reference}`);
      }
      const matches = matchingBodies(entity, bodyNames);
      if (!matches.length) throw new Error(`No MuJoCo body matches BDDL entity: ${entity}`);
      for (const bodyName of matches) {
        const roles = rolesByBody.get(bodyName) ?? new Set<TaskCueRole>();
        roles.add(role);
        rolesByBody.set(bodyName, roles);
      }
    };

    for (const goal of goals) {
      if (goal.predicate === "on" || goal.predicate === "in") {
        applyRole(goal.references[0] as string, "manipulated");
        applyRole(goal.references[1] as string, "destination");
      } else {
        applyRole(goal.references[0] as string, "manipulated");
      }
    }

    if (!rolesByBody.size) throw new Error("BDDL goal has no renderable MuJoCo body");
    return {
      status: "resolved",
      goals,
      bodies: [...rolesByBody]
        .map(([bodyName, roles]) => ({
          bodyName,
          roles: [...roles].sort() as TaskCueRole[],
        }))
        .sort((a, b) => a.bodyName.localeCompare(b.bodyName)),
      unrenderedRegions: [...unrenderedRegions].sort(),
    };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "Task cue resolution failed",
    };
  }
}
