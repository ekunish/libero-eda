"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Database, FlaskConical, Play, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type EpisodeRecord, type Page, type TaskFamily, type TaskRecord } from "@/shared/api";
import { Button, IconButton, Input } from "@/shared/ui/primitives";

function ResultGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-base-300 py-2 first:border-t-0">
      <h2 className="px-4 py-2 text-xs font-semibold text-base-content/50">{title}</h2>
      {children}
    </section>
  );
}

function ResultLink({
  href,
  icon,
  title,
  meta,
  onSelect,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  meta: string;
  onSelect: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onSelect}
      className="flex min-h-12 items-center gap-3 px-4 py-2.5 hover:bg-base-200 focus-visible:bg-base-200"
    >
      <span className="text-base-content/50">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="mono mt-0.5 block truncate text-xs text-base-content/45">{meta}</span>
      </span>
    </Link>
  );
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const normalized = query.trim();
  const enabled = open && normalized.length >= 2;
  const encoded = encodeURIComponent(normalized);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const families = useQuery({
    queryKey: ["global-search", "families", normalized],
    queryFn: () => api<Page<TaskFamily>>(`/task-families?q=${encoded}&limit=6`),
    enabled,
  });
  const variants = useQuery({
    queryKey: ["global-search", "variants", normalized],
    queryFn: () =>
      api<Page<TaskRecord>>(
        `/tasks?q=${encoded}&source=libero_plus&entry_kind=changed_variant&limit=6`,
      ),
    enabled,
  });
  const originalRecordings = useQuery({
    queryKey: ["global-search", "recordings", "original_libero", normalized],
    queryFn: () =>
      api<Page<EpisodeRecord>>(
        `/datasets/episodes?dataset_id=original_libero&q=${encoded}&limit=6`,
      ),
    enabled,
  });
  const plusRecordings = useQuery({
    queryKey: ["global-search", "recordings", "lerobot_libero_plus", normalized],
    queryFn: () =>
      api<Page<EpisodeRecord>>(
        `/datasets/episodes?dataset_id=lerobot_libero_plus&q=${encoded}&limit=6`,
      ),
    enabled,
  });
  const resultCount =
    (families.data?.items.length ?? 0) +
    (variants.data?.items.length ?? 0) +
    (originalRecordings.data?.items.length ?? 0) +
    (plusRecordings.data?.items.length ?? 0);
  const searching =
    families.isFetching ||
    variants.isFetching ||
    originalRecordings.isFetching ||
    plusRecordings.isFetching;
  const failed =
    families.isError || variants.isError || originalRecordings.isError || plusRecordings.isError;
  const close = () => setOpen(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button
          size="sm"
          variant="secondary"
          className="mr-auto size-9 shrink-0 justify-center gap-2 p-0 text-xs text-base-content/60 lg:h-9 lg:w-64 lg:justify-start lg:px-3 lg:text-left xl:w-80 2xl:w-[28rem]"
          aria-label="Search recorded data and evaluation conditions"
        >
          <Search size={14} />
          <span className="hidden truncate lg:block">Search data and conditions</span>
          <kbd className="kbd kbd-xs ml-auto hidden bg-base-100 text-base-content/50 2xl:inline-flex">
            Ctrl K
          </kbd>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/45" />
        <Dialog.Content className="fixed left-1/2 top-[10vh] z-[81] flex max-h-[78vh] w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-xl focus:outline-none">
          <Dialog.Title className="sr-only">Global search</Dialog.Title>
          <Dialog.Description className="sr-only">
            Search Original LIBERO tasks, LIBERO-Plus evaluation conditions, and recorded datasets.
          </Dialog.Description>
          <div className="flex shrink-0 items-center gap-3 border-b border-base-300 px-4">
            <Search size={18} className="text-base-content/45" />
            <Input
              size="md"
              aria-label="Search query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Enter at least 2 characters"
              className="h-14 min-w-0 flex-1 border-0 bg-transparent px-0 text-base outline-none placeholder:text-base-content/35 focus:outline-none"
            />
            <Dialog.Close asChild>
              <IconButton variant="ghost" aria-label="Close search">
                <X size={18} />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {normalized.length < 2 ? (
              <p className="p-6 text-sm leading-6 text-base-content/60">
                Search by source instruction, task key, or episode number.
              </p>
            ) : failed ? (
              <p role="alert" className="p-6 text-sm leading-6 text-error">
                Search results are incomplete. Check the hosted data connection.
              </p>
            ) : resultCount === 0 && !searching ? (
              <p className="p-6 text-sm text-base-content/60">No matching data.</p>
            ) : (
              <>
                {families.data?.items.length ? (
                  <ResultGroup title={`Original LIBERO tasks · ${families.data.total}`}>
                    {families.data.items.map((family) => (
                      <ResultLink
                        key={family.task_key}
                        href={`/data?task=${encodeURIComponent(family.task_key)}`}
                        icon={<Database size={16} />}
                        title={family.instruction}
                        meta={family.task_key}
                        onSelect={close}
                      />
                    ))}
                  </ResultGroup>
                ) : null}
                {variants.data?.items.length ? (
                  <ResultGroup title={`LIBERO-Plus conditions · ${variants.data.total}`}>
                    {variants.data.items.map((variant) => (
                      <ResultLink
                        key={variant.task_key}
                        href={`/evaluation?condition=${encodeURIComponent(variant.task_key)}`}
                        icon={<FlaskConical size={16} />}
                        title={variant.instruction}
                        meta={variant.task_key}
                        onSelect={close}
                      />
                    ))}
                  </ResultGroup>
                ) : null}
                {originalRecordings.data?.items.length ? (
                  <ResultGroup
                    title={`Original LIBERO demonstrations · ${originalRecordings.data.total}`}
                  >
                    {originalRecordings.data.items.map((episode) => (
                      <ResultLink
                        key={episode.replay_id}
                        href={`/replay/?replay_id=${encodeURIComponent(episode.replay_id)}&replay_scope=task`}
                        icon={<Play size={16} />}
                        title={episode.task_instruction}
                        meta={`Demo ${episode.episode_index + 1} · ${episode.length} frames`}
                        onSelect={close}
                      />
                    ))}
                  </ResultGroup>
                ) : null}
                {plusRecordings.data?.items.length ? (
                  <ResultGroup
                    title={`LIBERO-Plus training records · ${plusRecordings.data.total}`}
                  >
                    {plusRecordings.data.items.map((episode) => (
                      <ResultLink
                        key={episode.replay_id}
                        href={`/replay/?replay_id=${encodeURIComponent(episode.replay_id)}&replay_scope=task`}
                        icon={<Play size={16} />}
                        title={episode.task_instruction}
                        meta={`Dataset episode #${episode.source_episode_id} · ${episode.length} frames`}
                        onSelect={close}
                      />
                    ))}
                  </ResultGroup>
                ) : null}
              </>
            )}
          </div>
          {searching ? (
            <div className="h-0.5 shrink-0 overflow-hidden bg-base-200">
              <div className="h-full w-1/2 animate-pulse bg-primary" />
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
