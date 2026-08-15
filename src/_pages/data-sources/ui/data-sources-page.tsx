"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowUpRight,
  Database,
  FileArchive,
  GitBranch,
  Waypoints,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Group, Panel, Separator } from "react-resizable-panels";
import { api, type DataSourceRecord, type DataSourceRegistry } from "@/shared/api";
import { cn } from "@/shared/lib/utils";
import { Badge, Button, ErrorPanel, Skeleton } from "@/shared/ui/primitives";

const roleLabels: Record<DataSourceRecord["role"], string> = {
  task_definitions: "Task definitions",
  recorded_trajectories: "Recorded trajectories",
  training_provenance: "Training provenance",
  evaluation_definitions: "Evaluation definitions",
  simulator_assets: "Simulator assets",
  related_package: "Related package (not loaded)",
};
const countLabels: Record<string, string> = {
  tasks: "Tasks",
  source_tasks: "Source tasks",
  conditions: "Conditions",
  categories: "Categories",
  episodes: "Trajectories",
  frames: "Frames",
  shards: "Shards",
  source_bytes: "Source size",
  stored_bytes: "Distributed size",
  local_derived_bytes: "Local derivative",
  archive_bytes: "Archive size",
};
const groupCopy: Record<
  DataSourceRegistry["groups"][number]["group_id"],
  { title: string; purpose: string }
> = {
  original_libero: {
    title: "Original LIBERO",
    purpose: "Source task definitions and official demonstrations",
  },
  libero_plus_training: {
    title: "LIBERO-Plus Training",
    purpose: "Successful trajectories with video, state, action, and source path tags",
  },
  libero_plus_evaluation: {
    title: "LIBERO-Plus Evaluation",
    purpose: "Changed simulator conditions, classification, and assets",
  },
  related_packages: {
    title: "Related packages",
    purpose: "Published companion datasets that this release does not load",
  },
};

function formatCount(key: string, value: number): string {
  if (key.endsWith("bytes")) {
    const gib = value / 1024 ** 3;
    return `${gib.toFixed(gib >= 10 ? 1 : 2)} GiB`;
  }
  return value.toLocaleString("en-US");
}

function UsageLinks({ source }: { source: DataSourceRecord }) {
  const recorded = ["task_definitions", "recorded_trajectories", "training_provenance"].includes(
    source.role,
  );
  const evaluation = source.role === "evaluation_definitions";
  return (
    <div className="flex flex-wrap gap-2">
      {recorded ? (
        <Button size="sm" variant="accent" asChild>
          <Link
            href={`/data${source.source_id === "libero_plus_lerobot" || source.source_id === "libero_plus_rlds_provenance" ? "?dataset=lerobot_libero_plus" : ""}`}
          >
            <Database size={14} /> Open Recorded Data
          </Link>
        </Button>
      ) : null}
      {evaluation ? (
        <Button size="sm" variant="accent" asChild>
          <Link href="/evaluation">
            <Waypoints size={14} /> Open Evaluation
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

function SourceDetail({ source }: { source: DataSourceRecord }) {
  const external = source.url.startsWith("http");
  const target =
    source.role === "related_package"
      ? "Not loaded by this release"
      : source.role === "simulator_assets"
        ? "Source reference only"
        : source.role === "evaluation_definitions"
          ? "Evaluation workspace"
          : "Recorded Data workspace";
  const indexed = ["related_package", "simulator_assets"].includes(source.role)
    ? "Source registry entry"
    : "Validated hosted index";
  return (
    <article className="h-full min-h-0 overflow-y-auto bg-base-100">
      <header className="border-b border-base-300 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="cyan">{roleLabels[source.role]}</Badge>
          <span className="mono text-xs text-base-content/45">pinned revision</span>
        </div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">{source.label}</h2>
            <p className="mono mt-1 break-all text-xs text-base-content/55">{source.revision}</p>
          </div>
          <Button size="sm" variant="accent" asChild>
            <Link
              href={source.url}
              target={external ? "_blank" : undefined}
              rel={external ? "noreferrer" : undefined}
            >
              Open source <ArrowUpRight size={14} />
            </Link>
          </Button>
        </div>
      </header>
      <section className="border-b border-base-300 px-5 py-4">
        <h3 className="text-xs font-semibold text-base-content/55">Data lineage</h3>
        <div className="mt-3 flex flex-wrap items-stretch gap-2 text-sm">
          <div className="min-w-44 flex-1 border border-base-300 bg-base-200 p-3">
            <p className="text-xs text-base-content/50">Pinned input</p>
            <p className="mt-1 font-semibold">{source.repository}</p>
          </div>
          <ArrowRight className="self-center text-base-content/35" size={17} />
          <div className="min-w-44 flex-1 border border-base-300 bg-base-200 p-3">
            <p className="text-xs text-base-content/50">Catalog treatment</p>
            <p className="mt-1 font-semibold">{indexed}</p>
          </div>
          <ArrowRight className="self-center text-base-content/35" size={17} />
          <div className="min-w-44 flex-1 border border-base-300 bg-base-200 p-3">
            <p className="text-xs text-base-content/50">Used by</p>
            <p className="mt-1 font-semibold">{target}</p>
          </div>
        </div>
        <div className="mt-3">
          <UsageLinks source={source} />
        </div>
      </section>
      <div className="grid divide-y divide-base-300 xl:grid-cols-2 xl:divide-x xl:divide-y-0">
        <section className="px-5 py-4">
          <h3 className="text-xs font-semibold text-base-content/55">Published source structure</h3>
          <ol className="mt-3 space-y-2">
            {source.structure.map((item, index) => (
              <li key={item} className="grid grid-cols-[1.5rem_1fr] gap-2 text-sm leading-6">
                <span className="mono text-xs text-base-content/40">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="px-5 py-4">
          <h3 className="text-xs font-semibold text-base-content/55">Validated scale</h3>
          <dl className="mt-3 grid gap-px overflow-hidden border border-base-300 bg-base-300 sm:grid-cols-2">
            {Object.entries(source.counts).map(([key, value]) => (
              <div key={key} className="bg-base-100 px-4 py-3">
                <dt className="text-xs text-base-content/50">{countLabels[key] ?? key}</dt>
                <dd className="mono mt-1 text-base font-semibold">{formatCount(key, value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </article>
  );
}

export default function DataSourcesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = useQuery({
    queryKey: ["data-sources"],
    queryFn: () => api<DataSourceRegistry>("/data-sources"),
  });
  const allSources = query.data?.groups.flatMap((group) => group.sources) ?? [];
  const requested = searchParams.get("source");
  const selected = allSources.find((source) => source.source_id === requested) ?? allSources[0];
  if (query.isError) return <ErrorPanel error={query.error} />;
  const sourceList = (
    <aside className="h-full min-h-0 overflow-y-auto bg-base-100">
      {query.data ? (
        query.data.groups.map((group) => {
          const copy = groupCopy[group.group_id];
          return (
            <section key={group.group_id}>
              <div className="sticky top-0 z-10 border-y border-base-300 bg-base-200 px-3 py-2.5 first:border-t-0">
                <div className="flex items-center gap-2">
                  <GitBranch size={13} className="text-primary" />
                  <h2 className="text-sm font-semibold">{copy.title}</h2>
                </div>
                <p className="mt-0.5 text-xs leading-5 text-base-content/55">{copy.purpose}</p>
              </div>
              {group.sources.map((source) => (
                <button
                  type="button"
                  key={source.source_id}
                  aria-current={selected?.source_id === source.source_id ? "true" : undefined}
                  onClick={() =>
                    router.replace(`/sources?source=${encodeURIComponent(source.source_id)}`, {
                      scroll: false,
                    })
                  }
                  className={cn(
                    "w-full border-b border-base-300 px-3 py-2.5 text-left hover:bg-base-200",
                    selected?.source_id === source.source_id &&
                      "bg-primary/8 shadow-[inset_3px_0_var(--color-primary)]",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <FileArchive size={14} className="text-base-content/45" />
                    <span className="truncate text-sm font-medium">{source.label}</span>
                  </div>
                  <p className="mono mt-1 truncate pl-[22px] text-xs text-base-content/45">
                    {roleLabels[source.role]} · {source.revision.slice(0, 12)}
                  </p>
                </button>
              ))}
            </section>
          );
        })
      ) : (
        <Skeleton className="m-3 h-96" />
      )}
    </aside>
  );
  return (
    <div className="viewport-page min-h-0 overflow-hidden border border-base-300 bg-base-100">
      <div className="hidden h-full min-h-0 xl:block">
        <Group
          orientation="horizontal"
          className="h-full min-h-0"
          id="sources-layout"
          defaultLayout={{ sources: 25, detail: 75 }}
        >
          <Panel id="sources" defaultSize="25%" minSize={320} maxSize={460}>
            {sourceList}
          </Panel>
          <Separator className="group relative w-px bg-base-300">
            <span className="absolute inset-y-0 -left-1.5 w-3 cursor-col-resize group-hover:bg-primary/10" />
          </Separator>
          <Panel id="detail" defaultSize="75%" minSize={560}>
            {selected ? <SourceDetail source={selected} /> : <Skeleton className="m-5 h-96" />}
          </Panel>
        </Group>
      </div>
      <div className="grid h-full min-h-0 grid-rows-[minmax(14rem,38%)_minmax(0,1fr)] xl:hidden">
        {sourceList}
        {selected ? <SourceDetail source={selected} /> : <Skeleton className="m-5 h-96" />}
      </div>
    </div>
  );
}
