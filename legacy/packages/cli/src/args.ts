// @anchor/cli — tiny dependency-free flag parser.
// Supports: subcommand positionals, --flag value, --flag=value, and boolean --flag.

export interface ParsedArgs {
  _: string[]; // positionals (e.g. the subcommand)
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) { flags[body.slice(0, eq)] = body.slice(eq + 1); continue; }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[body] = next; i++; }
      else flags[body] = true;
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

export function str(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}
export function bool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === 'true';
}
