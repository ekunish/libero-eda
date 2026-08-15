import type { ReactNode } from "react";
import type { TaskDetail } from "@/shared/api";
import { Badge } from "@/shared/ui/primitives";
import {
  type BddlPredicate,
  type BddlTaskDefinitionResult,
  type TaskCueReference,
  type TaskCueResolution,
  taskCueReferences,
} from "../model/task-cues";

function predicateText(predicate: BddlPredicate): string {
  return `${predicate.predicate.toUpperCase()} ${predicate.references.join(" → ")}`;
}

function referenceRole(reference: TaskCueReference): "manipulated" | "destination" | "both" {
  if (reference.roles.includes("manipulated") && reference.roles.includes("destination")) {
    return "both";
  }
  return reference.roles.includes("destination") ? "destination" : "manipulated";
}

const rolePresentation = {
  manipulated: {
    label: "Manipulated",
    dot: "bg-[#ffb15c] shadow-[0_0_7px_2px_rgba(255,177,92,0.45)]",
  },
  destination: {
    label: "Destination",
    dot: "bg-[#62dce9] shadow-[0_0_7px_2px_rgba(98,220,233,0.4)]",
  },
  both: {
    label: "Both roles",
    dot: "bg-white shadow-[0_0_7px_2px_rgba(255,255,255,0.5)]",
  },
} as const;

function Disclosure({
  label,
  count,
  children,
  testId,
}: {
  label: string;
  count?: number;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <details className="group border-t border-base-300 py-2" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold marker:hidden">
        <span>{label}</span>
        <span className="mono text-[11px] font-normal text-base-content/45">
          {count == null ? "View" : count.toLocaleString("en-US")}
        </span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export function TaskDefinitionInspector({
  detail,
  parsed,
  cueResolution,
  sourceTask,
  taskCuesEnabled,
}: {
  detail: TaskDetail;
  parsed: BddlTaskDefinitionResult;
  cueResolution: TaskCueResolution | null;
  sourceTask: boolean;
  taskCuesEnabled: boolean;
}) {
  return (
    <section className="border-b border-base-300 p-3" data-testid="task-definition-inspector">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-base-content/55">
          {sourceTask ? "Source task definition (BDDL)" : "Task definition (BDDL)"}
        </h2>
        {cueResolution?.status === "resolved" ? (
          <Badge tone={taskCuesEnabled ? "green" : "neutral"}>
            3D cues {taskCuesEnabled ? "on" : "off"}
          </Badge>
        ) : null}
      </div>
      {sourceTask ? (
        <p className="mt-2 text-xs leading-5 text-base-content/60">
          This is the Original LIBERO source-task definition. The distributed LIBERO-Plus training
          record does not contain a record-specific BDDL environment definition.
        </p>
      ) : null}

      {parsed.status === "unavailable" ? (
        <>
          <div
            role="alert"
            className="alert alert-warning alert-soft mt-3 block rounded p-2 text-xs"
          >
            <strong className="block">Structured BDDL view unavailable</strong>
            <span className="mt-1 block break-words">{parsed.reason}</span>
          </div>
          <Disclosure label="Raw BDDL" testId="raw-bddl-disclosure">
            <pre className="mono max-h-80 overflow-auto whitespace-pre-wrap break-words bg-base-200 p-2 text-[11px] leading-5">
              {detail.bddl}
            </pre>
          </Disclosure>
        </>
      ) : (
        <>
          <p className="mt-3 text-xs font-medium leading-5">{parsed.definition.language}</p>
          <dl className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
            <dt className="text-base-content/45">Problem</dt>
            <dd className="mono break-all">{parsed.definition.problem}</dd>
            <dt className="text-base-content/45">Domain</dt>
            <dd className="mono break-all">{parsed.definition.domain}</dd>
          </dl>

          <div className="mt-3" data-testid="bddl-success-goals">
            <h3 className="text-xs font-semibold">Success goals</h3>
            <ol className="mt-2 space-y-1.5">
              {parsed.definition.goals.map((goal) => (
                <li
                  key={`${goal.index}-${goal.predicate}-${goal.references.join("-")}`}
                  className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 text-xs"
                >
                  <Badge tone="cyan">{goal.predicate.toUpperCase()}</Badge>
                  <code className="mono break-all leading-5">{goal.references.join(" → ")}</code>
                </li>
              ))}
            </ol>
          </div>

          <div className="mt-3" data-testid="bddl-task-roles">
            <h3 className="text-xs font-semibold">Task roles</h3>
            <ul className="mt-2 space-y-1.5">
              {taskCueReferences(parsed.definition).map((reference) => {
                const role = referenceRole(reference);
                const presentation = rolePresentation[role];
                return (
                  <li
                    key={reference.reference}
                    className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 text-xs"
                  >
                    <span className="mt-1 inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-base-content/60">
                      <span aria-hidden className={`size-2 rounded-full ${presentation.dot}`} />
                      {presentation.label}
                    </span>
                    <code className="mono break-all leading-5">{reference.reference}</code>
                  </li>
                );
              })}
            </ul>
            {cueResolution?.status === "resolved" ? (
              <div className="mt-2 border-l-2 border-base-300 pl-2 text-[11px] leading-5 text-base-content/55">
                <p>3D bodies: {cueResolution.bodies.map((body) => body.bodyName).join(", ")}</p>
                {cueResolution.unrenderedRegions.length ? (
                  <p>Abstract regions not rendered: {cueResolution.unrenderedRegions.join(", ")}</p>
                ) : null}
              </div>
            ) : cueResolution?.status === "unavailable" ? (
              <p role="alert" className="mt-2 text-[11px] leading-5 text-warning">
                3D cue mapping unavailable: {cueResolution.reason}
              </p>
            ) : null}
          </div>

          <div className="mt-3">
            <Disclosure
              label="Initial state"
              count={parsed.definition.initialState.length}
              testId="bddl-initial-state"
            >
              {parsed.definition.initialState.length ? (
                <ol className="space-y-1 text-[11px]">
                  {parsed.definition.initialState.map((item) => (
                    <li key={predicateText(item)} className="mono break-all leading-5">
                      {predicateText(item)}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[11px] text-base-content/50">No initial predicates.</p>
              )}
            </Disclosure>
            <Disclosure
              label="Entities"
              count={parsed.definition.fixtures.length + parsed.definition.objects.length}
              testId="bddl-entities"
            >
              <div className="space-y-3 text-[11px]">
                <div>
                  <h4 className="font-semibold">Fixtures</h4>
                  <ul className="mt-1 space-y-0.5">
                    {parsed.definition.fixtures.map((entity) => (
                      <li key={entity.name} className="mono break-all">
                        {entity.name} <span className="text-base-content/45">— {entity.type}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold">Objects</h4>
                  <ul className="mt-1 space-y-0.5">
                    {parsed.definition.objects.map((entity) => (
                      <li key={entity.name} className="mono break-all">
                        {entity.name} <span className="text-base-content/45">— {entity.type}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="font-semibold">Objects of interest</h4>
                  <p className="mono mt-1 break-all leading-5">
                    {parsed.definition.objectsOfInterest.join(", ")}
                  </p>
                </div>
              </div>
            </Disclosure>
            <Disclosure
              label="Regions"
              count={parsed.definition.regions.length}
              testId="bddl-regions"
            >
              {parsed.definition.regions.length ? (
                <ul className="space-y-2 text-[11px]">
                  {parsed.definition.regions.map((region) => (
                    <li key={region.qualifiedName} className="border-l-2 border-base-300 pl-2">
                      <code className="mono break-all font-semibold">{region.qualifiedName}</code>
                      <dl className="mt-1 grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-1 gap-y-0.5">
                        <dt className="text-base-content/45">Target</dt>
                        <dd className="mono break-all">{region.target}</dd>
                        {region.ranges.length ? (
                          <>
                            <dt className="text-base-content/45">Ranges</dt>
                            <dd className="mono break-all">
                              {region.ranges.map((range) => `[${range.join(", ")}]`).join("; ")}
                            </dd>
                          </>
                        ) : null}
                        {region.yawRotations.length ? (
                          <>
                            <dt className="text-base-content/45">Yaw</dt>
                            <dd className="mono break-all">
                              {region.yawRotations
                                .map((range) => `[${range.join(", ")}]`)
                                .join("; ")}
                            </dd>
                          </>
                        ) : null}
                      </dl>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-base-content/50">No regions declared.</p>
              )}
            </Disclosure>
            <Disclosure label="Raw BDDL" testId="raw-bddl-disclosure">
              <pre className="mono max-h-80 overflow-auto whitespace-pre-wrap break-words bg-base-200 p-2 text-[11px] leading-5">
                {detail.bddl}
              </pre>
            </Disclosure>
          </div>
        </>
      )}
    </section>
  );
}
