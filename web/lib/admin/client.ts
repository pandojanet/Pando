"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminAction, AdminResource } from "./types";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    // Session expired mid-session: back to the form rather than a silent failure.
    window.location.href = "/admin/login";
    throw new Error("signed out");
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      (detail as { error?: string } | null)?.error ?? `Request failed (${res.status})`,
    );
  }
  return (await res.json()) as T;
}

interface QueryResponse<T> {
  configured: boolean;
  rows: T;
  sample?: boolean;
}

/**
 * Loads one resource for a page. Returns `configured: false` when `DATABASE_URL`
 * isn't set yet — pages show that state instead of pretending they have data, and
 * offer sample rows for reviewing the layout.
 */
export function useAdminRows<T>(
  resource: AdminResource,
  params?: Record<string, unknown>,
  /**
   * Set false to hold the request back until the page actually needs the rows.
   * A query is ~200ms of round trip whatever it returns, so a list fetched for a
   * control the admin may never open is 200ms spent on nothing.
   */
  enabled = true,
) {
  const [rows, setRows] = useState<T | null>(null);
  const [configured, setConfigured] = useState(true);
  const [sample, setSample] = useState(false);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const key = JSON.stringify(params ?? {});

  const load = useCallback(
    async (withDemo: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const data = await post<QueryResponse<T>>("/api/admin/query", {
          resource,
          params: JSON.parse(key) as Record<string, unknown>,
          demo: withDemo,
        });
        setRows(data.rows);
        setConfigured(data.configured);
        setSample(data.sample === true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load that");
      } finally {
        setLoading(false);
      }
    },
    [resource, key],
  );

  useEffect(() => {
    if (!enabled) return;
    void load(demo);
  }, [load, demo, enabled]);

  return {
    rows,
    configured,
    sample,
    demo,
    setDemo,
    loading,
    error,
    reload: () => load(demo),
  };
}

export async function adminAction(
  action: AdminAction,
): Promise<{ ok: true; persisted: boolean; actor: string }> {
  return post("/api/admin/action", action);
}

/**
 * A caregiver's restricted note (C6b, or the reason behind a hesitant C7), fetched one
 * at a time and only when an admin asks for it.
 *
 * It is not part of the caregiver list on purpose: a list view that carried these
 * would leak them into every screenshot, every export and every browser cache
 * (invariant 12). The read itself is worth logging, which is why it goes through the
 * same query endpoint as everything else.
 */
export async function readRestrictedNote(
  nominationId: string,
): Promise<string | null> {
  const data = await post<QueryResponse<{ body?: string } | null>>(
    "/api/admin/query",
    { resource: "restricted_note", params: { nomination_id: nominationId } },
  );
  if (!data.configured) {
    return "No database is connected yet, so there is nothing to show.";
  }
  return data.rows?.body ?? "No note on this nomination.";
}

export async function signOut(): Promise<void> {
  await fetch("/api/admin/session", { method: "DELETE" });
  window.location.href = "/admin/login";
}
