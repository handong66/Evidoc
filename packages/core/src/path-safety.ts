import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export function normalizeRepositoryRelativePath(input: string): string | undefined {
  const normalized = input.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized !== normalized.trim() ||
    normalized.includes("\0") ||
    normalized.includes("\n") ||
    normalized.includes("\r") ||
    normalized.startsWith("/") ||
    normalized.includes(":")
  ) {
    return undefined;
  }

  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    return undefined;
  }

  return normalized;
}

export function isPathInsideRoot(
  root: string,
  target: string,
  options: { allowRoot?: boolean } = {}
): boolean {
  const inside = relative(root, target);
  if (!inside) return options.allowRoot ?? false;
  return !inside.startsWith("..") && !isAbsolute(inside) && !inside.includes(":");
}

export async function resolveExistingPathInsideRoot(
  root: string,
  repoRelativePath: string
): Promise<string | undefined> {
  const normalized = normalizeRepositoryRelativePath(repoRelativePath);
  if (!normalized) return undefined;

  const rootReal = await realpathOrUndefined(resolve(root));
  if (!rootReal) return undefined;

  const target = resolve(rootReal, normalized);
  const targetReal = await realpathOrUndefined(target);
  if (!targetReal || !isPathInsideRoot(rootReal, targetReal)) {
    return undefined;
  }

  return targetReal;
}

export async function resolveWritablePathInsideRoot(
  root: string,
  repoRelativePath: string
): Promise<string | undefined> {
  const normalized = normalizeRepositoryRelativePath(repoRelativePath);
  if (!normalized) return undefined;

  const rootReal = await realpathOrUndefined(resolve(root));
  if (!rootReal) return undefined;

  const target = resolve(rootReal, normalized);
  if (!isPathInsideRoot(rootReal, target)) return undefined;

  const targetReal = await realpathOrUndefined(target);
  if (targetReal && !isPathInsideRoot(rootReal, targetReal)) {
    return undefined;
  }

  const ancestorReal = await realExistingAncestor(dirname(target), rootReal);
  if (!ancestorReal || !isPathInsideRoot(rootReal, ancestorReal, { allowRoot: true })) {
    return undefined;
  }

  return target;
}

export async function resolveExistingRootInsideBoundary(
  boundaryRoot: string,
  requestedRoot: string
): Promise<string | undefined> {
  const boundaryReal = await realpathOrUndefined(resolve(boundaryRoot));
  if (!boundaryReal) return undefined;

  const target = resolve(boundaryReal, requestedRoot);
  const targetReal = await realpathOrUndefined(target);
  if (!targetReal || !isPathInsideRoot(boundaryReal, targetReal, { allowRoot: true })) {
    return undefined;
  }

  const targetStats = await stat(targetReal).catch(() => undefined);
  if (!targetStats?.isDirectory()) return undefined;

  return targetReal;
}

async function realExistingAncestor(path: string, rootReal: string): Promise<string | undefined> {
  let current = path;

  while (isPathInsideRoot(rootReal, current, { allowRoot: true })) {
    const currentReal = await realpathOrUndefined(current);
    if (currentReal) return currentReal;

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }

  return undefined;
}

async function realpathOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}
