import fs from 'fs';
import path from 'path';

const DEFAULT_ROOT = 'mcp-files';
const UNRESTRICTED = '*';

let resolvedRoot;
let warnedUnrestricted = false;

function isInside(root, target) {
  if (target === root) return true;
  const rel = path.relative(root, target);
  return rel !== '' && !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
}

function realpathOfNearestExisting(target) {
  let current = target;
  for (;;) {
    try {
      return fs.realpathSync(current);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const parent = path.dirname(current);
      if (parent === current) throw new Error(`Cannot resolve any part of '${target}'`);
      current = parent;
    }
  }
}

export function localFileRoot() {
  if (resolvedRoot !== undefined) return resolvedRoot;

  const configured = process.env.MESH_LOCAL_FILE_ROOT || DEFAULT_ROOT;
  if (configured === UNRESTRICTED) {
    if (!warnedUnrestricted) {
      warnedUnrestricted = true;
      console.error(
        '[meshcentral-mcp] WARNING: MESH_LOCAL_FILE_ROOT=* - local file access is unrestricted. ' +
          'mesh_file_download can write anywhere this process can write, and mesh_file_upload can read ' +
          'any file it can read.'
      );
    }
    resolvedRoot = null;
    return resolvedRoot;
  }

  const target = path.resolve(configured);
  fs.mkdirSync(target, { recursive: true });
  resolvedRoot = fs.realpathSync(target);
  return resolvedRoot;
}

export function resolveLocalPath(rawPath, { mustExist = false } = {}) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new Error('A local path is required');
  }

  const root = localFileRoot();
  if (root === null) {
    const unrestricted = path.resolve(rawPath);
    if (mustExist && !fs.existsSync(unrestricted)) {
      throw new Error(`Local file not found: ${unrestricted}`);
    }
    return unrestricted;
  }

  const resolved = path.resolve(root, rawPath);
  if (!isInside(root, resolved)) {
    throw new Error(
      `Local path '${rawPath}' is outside the permitted directory (${root}). ` +
        'Local file access is confined to that directory; set MESH_LOCAL_FILE_ROOT to move it.'
    );
  }

  const realAncestor = realpathOfNearestExisting(resolved);
  if (!isInside(root, realAncestor)) {
    throw new Error(
      `Local path '${rawPath}' resolves outside the permitted directory (${root}) via a symbolic link.`
    );
  }

  if (mustExist) {
    if (!fs.existsSync(resolved)) {
      throw new Error(`Local file not found: ${resolved}`);
    }
    const real = fs.realpathSync(resolved);
    if (!isInside(root, real)) {
      throw new Error(
        `Local path '${rawPath}' resolves outside the permitted directory (${root}) via a symbolic link.`
      );
    }
    return real;
  }

  return resolved;
}
