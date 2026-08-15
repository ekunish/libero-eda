export type TaskCueRole = "manipulated" | "destination";

export type TaskCueGoalPredicate = "on" | "in" | "open" | "close" | "turnon" | "turnoff";

export type BddlPredicate = {
  predicate: string;
  references: string[];
};

export type TaskCueGoal = BddlPredicate & {
  index: number;
  predicate: TaskCueGoalPredicate;
};

export type BddlEntity = {
  name: string;
  type: string;
};

export type BddlRegion = {
  name: string;
  qualifiedName: string;
  target: string;
  ranges: number[][];
  yawRotations: number[][];
};

export type BddlTaskDefinition = {
  problem: string;
  domain: string;
  language: string;
  fixtures: BddlEntity[];
  objects: BddlEntity[];
  objectsOfInterest: string[];
  regions: BddlRegion[];
  initialState: BddlPredicate[];
  goals: TaskCueGoal[];
};

export type BddlTaskDefinitionResult =
  | { status: "parsed"; definition: BddlTaskDefinition }
  | { status: "unavailable"; reason: string };

export type TaskCueBody = {
  bodyName: string;
  roles: TaskCueRole[];
};

export type TaskCueReference = {
  reference: string;
  roles: TaskCueRole[];
};

export type TaskCueResolution =
  | {
      status: "resolved";
      goals: TaskCueGoal[];
      references: TaskCueReference[];
      bodies: TaskCueBody[];
      unrenderedRegions: string[];
    }
  | { status: "unavailable"; reason: string };

type SExpression = string | SExpression[];

const supportedPredicates = new Set<TaskCueGoalPredicate>([
  "on",
  "in",
  "open",
  "close",
  "turnon",
  "turnoff",
]);

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

function requiredSection(root: SExpression, name: string): SExpression[] {
  const value = section(root, name);
  if (!value) throw new Error(`BDDL is missing ${name}`);
  return value;
}

function stringItems(expression: SExpression[], sectionName: string): string[] {
  const items = expression.filter((item): item is string => typeof item === "string");
  if (items.length !== expression.length) {
    throw new Error(`BDDL ${sectionName} contains a nested declaration`);
  }
  return items;
}

function typedEntities(root: SExpression, sectionName: ":fixtures" | ":objects"): BddlEntity[] {
  const declaration = requiredSection(root, sectionName);
  const tokens = stringItems(declaration.slice(1), sectionName);
  const entities: BddlEntity[] = [];
  let pending: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) throw new Error(`BDDL contains an invalid ${sectionName} token`);
    if (token === "-") {
      const entityType = tokens[index + 1];
      if (!pending.length || !entityType || entityType === "-") {
        throw new Error(`BDDL contains an invalid ${sectionName} declaration`);
      }
      for (const name of pending) entities.push({ name, type: entityType });
      pending = [];
      index += 1;
    } else {
      pending.push(token);
    }
  }
  if (pending.length) throw new Error(`BDDL contains an untyped ${sectionName} declaration`);
  return entities;
}

function numericRows(expression: SExpression[] | null, attribute: string): number[][] {
  if (!expression) return [];
  const rows: number[][] = [];

  function visit(node: SExpression): void {
    if (!Array.isArray(node)) return;
    if (node.length > 0 && node.every((item) => typeof item === "string")) {
      const row = node.map(Number);
      if (!row.every(Number.isFinite)) {
        throw new Error(`BDDL ${attribute} contains a non-numeric value`);
      }
      rows.push(row);
      return;
    }
    for (const child of node) visit(child);
  }

  for (const child of expression.slice(1)) visit(child);
  return rows;
}

function regions(root: SExpression): BddlRegion[] {
  const declaration = requiredSection(root, ":regions");
  const result: BddlRegion[] = [];
  const qualifiedNames = new Set<string>();
  for (const item of declaration.slice(1)) {
    if (!Array.isArray(item) || typeof item[0] !== "string") {
      throw new Error("BDDL :regions contains an invalid declaration");
    }
    const name = item[0];
    const target = section(item, ":target");
    const targetName = target && typeof target[1] === "string" ? target[1] : null;
    if (!targetName) throw new Error(`BDDL region ${name} is missing its :target`);
    const qualifiedName = `${targetName}_${name}`;
    if (qualifiedNames.has(qualifiedName)) {
      throw new Error(`BDDL region is duplicated: ${qualifiedName}`);
    }
    qualifiedNames.add(qualifiedName);
    result.push({
      name,
      qualifiedName,
      target: targetName,
      ranges: numericRows(section(item, ":ranges"), ":ranges"),
      yawRotations: numericRows(section(item, ":yaw_rotation"), ":yaw_rotation"),
    });
  }
  return result;
}

function predicate(expression: SExpression, context: string): BddlPredicate {
  if (!Array.isArray(expression) || typeof expression[0] !== "string") {
    throw new Error(`BDDL ${context} contains an invalid predicate`);
  }
  const references = expression.slice(1);
  if (!references.every((item): item is string => typeof item === "string")) {
    throw new Error(`BDDL ${context} predicate ${expression[0]} contains a nested argument`);
  }
  return { predicate: expression[0].toLowerCase(), references };
}

function predicates(root: SExpression, sectionName: ":init" | ":goal"): BddlPredicate[] {
  const declaration = requiredSection(root, sectionName);
  const result: BddlPredicate[] = [];

  function visit(expression: SExpression): void {
    if (
      Array.isArray(expression) &&
      typeof expression[0] === "string" &&
      expression[0].toLowerCase() === "and"
    ) {
      for (const child of expression.slice(1)) visit(child);
      return;
    }
    result.push(predicate(expression, sectionName));
  }

  for (const expression of declaration.slice(1)) visit(expression);
  return result;
}

function goalPredicates(root: SExpression): TaskCueGoal[] {
  const parsed = predicates(root, ":goal");
  if (!parsed.length) throw new Error("BDDL goal contains no predicate");
  return parsed.map((item, index) => {
    if (!supportedPredicates.has(item.predicate as TaskCueGoalPredicate)) {
      throw new Error(`BDDL goal predicate is unsupported: ${item.predicate}`);
    }
    const predicateName = item.predicate as TaskCueGoalPredicate;
    const expectedArguments = predicateName === "on" || predicateName === "in" ? 2 : 1;
    if (item.references.length !== expectedArguments) {
      throw new Error(
        `BDDL goal predicate ${item.predicate} expects ${expectedArguments} arguments`,
      );
    }
    return { ...item, index, predicate: predicateName };
  });
}

function definitionFromBddl(bddl: string): BddlTaskDefinition {
  const root = parseBddl(bddl);
  const problem = section(root, "problem");
  const problemName = problem && typeof problem[1] === "string" ? problem[1] : null;
  if (!problemName) throw new Error("BDDL is missing its problem name");
  const domain = requiredSection(root, ":domain");
  const domainName = typeof domain[1] === "string" ? domain[1] : null;
  if (!domainName) throw new Error("BDDL is missing its domain name");
  const language = requiredSection(root, ":language");
  const languageText = stringItems(language.slice(1), ":language").join(" ").trim();
  if (!languageText) throw new Error("BDDL :language is empty");
  const objectsOfInterest = stringItems(
    requiredSection(root, ":obj_of_interest").slice(1),
    ":obj_of_interest",
  );
  if (!objectsOfInterest.length) throw new Error("BDDL :obj_of_interest is empty");
  return {
    problem: problemName,
    domain: domainName,
    language: languageText,
    fixtures: typedEntities(root, ":fixtures"),
    objects: typedEntities(root, ":objects"),
    objectsOfInterest,
    regions: regions(root),
    initialState: predicates(root, ":init"),
    goals: goalPredicates(root),
  };
}

export function parseTaskDefinition(bddl: string): BddlTaskDefinitionResult {
  try {
    return { status: "parsed", definition: definitionFromBddl(bddl) };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "BDDL parsing failed",
    };
  }
}

export function taskCueReferences(definition: BddlTaskDefinition): TaskCueReference[] {
  const rolesByReference = new Map<string, Set<TaskCueRole>>();
  const applyRole = (reference: string, role: TaskCueRole): void => {
    const roles = rolesByReference.get(reference) ?? new Set<TaskCueRole>();
    roles.add(role);
    rolesByReference.set(reference, roles);
  };
  for (const goal of definition.goals) {
    applyRole(goal.references[0] as string, "manipulated");
    if (goal.predicate === "on" || goal.predicate === "in") {
      applyRole(goal.references[1] as string, "destination");
    }
  }
  return [...rolesByReference]
    .map(([reference, roles]) => ({
      reference,
      roles: [...roles].sort() as TaskCueRole[],
    }))
    .sort((a, b) => a.reference.localeCompare(b.reference));
}

function matchingBodies(entity: string, bodyNames: readonly string[]): string[] {
  return bodyNames.filter((bodyName) => bodyName === entity || bodyName.startsWith(`${entity}_`));
}

export function resolveTaskCues(
  definition: BddlTaskDefinition,
  bodyNames: readonly string[],
): TaskCueResolution {
  try {
    const entities = new Map(
      [...definition.fixtures, ...definition.objects].map((entity) => [entity.name, entity.type]),
    );
    const regionTargets = new Map(
      definition.regions.map((region) => [region.qualifiedName, region.target]),
    );
    const interestReferences = new Set(definition.objectsOfInterest);
    const references = taskCueReferences(definition);
    const rolesByBody = new Map<string, Set<TaskCueRole>>();
    const unrenderedRegions = new Set<string>();

    const applyRole = (reference: string, role: TaskCueRole): void => {
      const regionTarget = regionTargets.get(reference);
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

    for (const reference of references) {
      for (const role of reference.roles) applyRole(reference.reference, role);
    }

    if (!rolesByBody.size) throw new Error("BDDL goal has no renderable MuJoCo body");
    return {
      status: "resolved",
      goals: definition.goals,
      references,
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
