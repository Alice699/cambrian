import { useCallback, useEffect, useRef, useState } from "react";
import { useThru } from "@thru/wallet/react";
import { listAccountTransactions, type CambrianTransactionSummary } from "@cambrian/sdk";
import { appConfig } from "../config";

export const ACTIVITY_PAGE_SIZE = 10;
type ActivityClient = Parameters<typeof listAccountTransactions>[0];
type ReadStatus = "idle" | "loading" | "ready" | "empty" | "needs-wallet" | "error";
type PageRequest = { index: number; token?: string };
type ActivityPage = { transactions: CambrianTransactionSummary[]; requestToken?: string; nextPageToken?: string };

interface ReadView {
  address: string | null;
  client: ActivityClient | null;
  status: ReadStatus;
  transactions: CambrianTransactionSummary[];
  page: number;
  requestedPage: number;
  hasNext: boolean;
  busy: boolean;
  error: string | null;
}

interface ReadScope {
  address: string;
  client: ActivityClient;
  alive: boolean;
  pages: ActivityPage[];
  index: number;
  pending: boolean;
  error: string | null;
  request: PageRequest;
  controller: AbortController | null;
}

function initialView(address: string | null, client: ActivityClient | null): ReadView {
  return { address, client, status: !address ? "needs-wallet" : client ? "loading" : "idle",
    transactions: [], page: 1, requestedPage: 1, hasNext: false, busy: Boolean(address), error: null };
}

/** Read-only cursor pagination. Page numbers refer only to pages actually visited. */
async function readPage(scope: ReadScope, request: PageRequest, publish: (scope: ReadScope) => void) {
  if (!scope.alive || scope.pending) return;
  scope.pending = true;
  scope.error = null;
  scope.request = request;
  const controller = new AbortController();
  scope.controller = controller;
  publish(scope);
  try {
    const result = await listAccountTransactions(scope.client, scope.address, {
      pageSize: ACTIVITY_PAGE_SIZE, pageToken: request.token,
      cambrianProgramId: appConfig.programId, signal: controller.signal,
    });
    if (!scope.alive || controller.signal.aborted) return;
    const nextToken = result.nextPageToken || undefined;
    if (nextToken && (nextToken === request.token || scope.pages.some(page => page.requestToken === nextToken))) {
      throw new Error("The network repeated a history page. Retry the read or refresh your activity.");
    }
    scope.pages[request.index] = { transactions: result.transactions, requestToken: request.token, nextPageToken: nextToken };
    scope.index = request.index;
  } catch (cause) {
    if (!scope.alive || controller.signal.aborted) return;
    // Keep the last verified page visible if a later page cannot be read.
    scope.error = cause instanceof Error ? cause.message : "Could not read this activity page.";
  } finally {
    if (scope.alive && !controller.signal.aborted) {
      scope.pending = false;
      scope.controller = null;
      publish(scope);
    }
  }
}

export function useActivityPagination(address: string | null) {
  const { thru } = useThru();
  const client = thru ?? null;
  const scopeRef = useRef<ReadScope | null>(null);
  const [view, setView] = useState<ReadView>(() => initialView(address, client));
  const publish = useCallback((scope: ReadScope) => {
    if (!scope.alive || scopeRef.current !== scope) return;
    const page = scope.pages[scope.index];
    setView({ address: scope.address, client: scope.client,
      status: page ? page.transactions.length ? "ready" : "empty" : scope.error ? "error" : "loading",
      transactions: page?.transactions ?? [], page: scope.index + 1,
      requestedPage: scope.request.index + 1, hasNext: Boolean(page?.nextPageToken),
      busy: scope.pending, error: scope.error });
  }, []);

  useEffect(() => {
    if (!address || !client) {
      scopeRef.current = null;
      setView(initialView(address, client));
      return;
    }
    const scope: ReadScope = { address, client, alive: true, pages: [], index: 0,
      pending: false, error: null, request: { index: 0 }, controller: null };
    scopeRef.current = scope;
    void readPage(scope, { index: 0 }, publish);
    return () => {
      scope.alive = false;
      scope.controller?.abort();
      if (scopeRef.current === scope) scopeRef.current = null;
    };
  }, [address, client, publish]);

  const currentScope = () => {
    const scope = scopeRef.current;
    return scope?.alive && !scope.pending && scope.address === address && scope.client === client ? scope : null;
  };
  const previous = () => {
    const scope = currentScope();
    if (!scope || scope.index === 0) return;
    scope.index -= 1;
    scope.error = null;
    publish(scope);
  };
  const next = () => {
    const scope = currentScope();
    const token = scope?.pages[scope.index]?.nextPageToken;
    if (!scope || !token) return;
    const index = scope.index + 1;
    if (scope.pages[index]) {
      scope.index = index;
      scope.error = null;
      publish(scope);
    } else void readPage(scope, { index, token }, publish);
  };
  const refresh = () => {
    const scope = currentScope();
    if (!scope) return;
    scope.pages = [];
    scope.index = 0;
    void readPage(scope, { index: 0 }, publish);
  };
  const retry = () => {
    const scope = currentScope();
    if (scope?.error) void readPage(scope, scope.request, publish);
  };

  // Never expose a previous account's page while effect cleanup is still pending.
  const visible = view.address === address && view.client === client ? view : initialView(address, client);
  return { ...visible, pageSize: ACTIVITY_PAGE_SIZE, previous, next, refresh, retry };
}
