// Client-side validation (Zod). The backend re-validates everything; these
// schemas mirror src-tauri/src/domain/validation.rs to give immediate,
// field-level feedback in forms.
import { z } from "zod";

// eslint-disable-next-line no-control-regex -- intentionally matches control characters
const CONTROL = /[\u0000-\u001f\u007f]/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const LABEL = /^(?!-)[A-Za-z0-9_-]{1,63}(?<!-)$/;

export function isValidIpv6(value: string): boolean {
  const v = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (!v.includes(":") || /[^0-9a-fA-F:.%]/.test(v.split("%")[0] ?? "")) return false;
  try {
    // URL parsing performs full IPv6 validation.
    new URL(`http://[${v.split("%")[0]}]/`);
    return true;
  } catch {
    return false;
  }
}

export function isValidHost(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 253) return false;
  if (IPV4.test(v) || isValidIpv6(v)) return true;
  const host = v.endsWith(".") ? v.slice(0, -1) : v;
  return host.split(".").every((label) => LABEL.test(label));
}

export const hostSchema = z
  .string()
  .trim()
  .min(1, "Host is required")
  .max(253, "Host must be at most 253 characters")
  .refine(isValidHost, "Enter a valid hostname, IPv4 or IPv6 address");

export const portSchema = z
  .number({ error: "Port must be a number" })
  .int("Port must be a whole number")
  .min(1, "Port must be between 1 and 65535")
  .max(65535, "Port must be between 1 and 65535");

export const usernameSchema = z
  .string()
  .trim()
  .min(1, "Username is required")
  .max(128, "Username must be at most 128 characters")
  .refine((v) => !/\s/.test(v) && !CONTROL.test(v), "Username must not contain spaces")
  .refine((v) => !v.startsWith("-"), "Username must not start with '-'");

export const nameSchema = (field: string, max = 100) =>
  z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .max(max, `${field} must be at most ${max} characters`)
    .refine((v) => !CONTROL.test(v), `${field} must not contain control characters`);

export const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(40, "Tags must be at most 40 characters")
  .regex(/^[\p{L}\p{N} ._:/-]+$/u, "Tags may contain letters, numbers, spaces and - _ . : /");

export const envVarSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/, "Invalid variable name"),
  value: z
    .string()
    .max(1024)
    .refine((v) => !CONTROL.test(v), "Value must not contain control characters"),
});

export const sshOptionsSchema = z.object({
  connectTimeoutSecs: z.number().int().min(1, "1–300 seconds").max(300, "1–300 seconds"),
  keepaliveIntervalSecs: z.number().int().min(0).max(3600, "At most 3600 seconds"),
  keepaliveMax: z.number().int().min(1, "1–20 attempts").max(20, "1–20 attempts"),
  env: z.array(envVarSchema).max(32),
});

export const terminalPrefsSchema = z.object({
  fontFamily: z.string().max(200).nullable().optional(),
  fontSize: z.number().int().min(8).max(40).nullable().optional(),
  scrollback: z.number().int().min(0).max(200000).nullable().optional(),
  theme: z.string().max(40).nullable().optional(),
  termType: z
    .string()
    .regex(/^[A-Za-z0-9._+-]{1,64}$/, "Invalid terminal type")
    .nullable()
    .optional(),
});

const baseProfile = z.object({
  groupId: z.string().nullable(),
  name: nameSchema("Name"),
  protocol: z.enum(["ssh", "local", "rdp", "vnc"]),
  host: z.string(),
  port: z.number(),
  username: z.string(),
  authMethod: z.enum(["password", "public_key", "agent", "keyboard_interactive"]),
  keyPath: z.string().nullable(),
  favorite: z.boolean(),
  notes: z.string().max(10000, "Notes must be at most 10000 characters"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable(),
  tags: z.array(tagSchema).max(32, "At most 32 tags"),
  terminal: terminalPrefsSchema,
  ssh: sshOptionsSchema,
});

export const profileInputSchema = baseProfile.superRefine((p, ctx) => {
  if (p.protocol === "local") return;
  const check = (schema: z.ZodType, value: unknown, path: string) => {
    const r = schema.safeParse(value);
    if (!r.success)
      ctx.addIssue({
        code: "custom",
        path: [path],
        message: r.error.issues[0]?.message ?? "Invalid",
      });
  };
  check(hostSchema, p.host, "host");
  check(portSchema, p.port, "port");
  if (p.protocol === "ssh" || p.username.trim()) check(usernameSchema, p.username, "username");
  if (p.protocol === "ssh" && p.authMethod === "public_key") {
    if (!p.keyPath || !p.keyPath.trim()) {
      ctx.addIssue({ code: "custom", path: ["keyPath"], message: "Choose a private key file" });
    } else if (CONTROL.test(p.keyPath) || p.keyPath.length > 1024) {
      ctx.addIssue({ code: "custom", path: ["keyPath"], message: "Invalid file path" });
    }
  }
});

export const quickConnectSchema = z
  .object({
    target: z.string().trim().min(1, "Enter a host, user@host or user@host:port"),
    username: z.string(),
    port: z.number(),
    authMethod: z.enum(["password", "public_key", "agent", "keyboard_interactive"]),
    keyPath: z.string().nullable(),
  })
  .transform((v, ctx) => {
    const parsed = parseTarget(v.target);
    const username = parsed.username ?? v.username.trim();
    const port = parsed.port ?? v.port;
    const results = [
      ["target", hostSchema.safeParse(parsed.host)],
      ["username", usernameSchema.safeParse(username)],
      ["port", portSchema.safeParse(port)],
    ] as const;
    for (const [path, r] of results) {
      if (!r.success)
        ctx.addIssue({
          code: "custom",
          path: [path],
          message: r.error.issues[0]?.message ?? "Invalid",
        });
    }
    if (v.authMethod === "public_key" && !v.keyPath?.trim()) {
      ctx.addIssue({ code: "custom", path: ["keyPath"], message: "Choose a private key file" });
    }
    return {
      host: parsed.host.trim(),
      username,
      port,
      authMethod: v.authMethod,
      keyPath: v.keyPath,
    };
  });

/** Parses "user@host:port", "host:port", "[ipv6]:port", "user@[ipv6]" or a bare host. */
export function parseTarget(input: string): { username?: string; host: string; port?: number } {
  let rest = input.trim();
  let username: string | undefined;
  const at = rest.lastIndexOf("@");
  if (at > 0) {
    username = rest.slice(0, at);
    rest = rest.slice(at + 1);
  }
  let port: number | undefined;
  if (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end > 0) {
      const after = rest.slice(end + 1);
      if (after.startsWith(":") && /^\d+$/.test(after.slice(1))) port = Number(after.slice(1));
      rest = rest.slice(1, end);
    }
  } else if ((rest.match(/:/g) ?? []).length === 1) {
    const [h, p] = rest.split(":");
    if (p && /^\d+$/.test(p)) {
      port = Number(p);
      rest = h ?? "";
    }
  }
  return { username, host: rest, port };
}

export const groupInputSchema = z.object({
  name: nameSchema("Group name"),
  parentId: z.string().nullable(),
  expanded: z.boolean(),
});

export const snippetInputSchema = z.object({
  name: nameSchema("Snippet name"),
  command: z
    .string()
    .max(20000, "Command must be at most 20000 characters")
    .refine((v) => v.trim().length > 0, "Command is required"),
  description: z.string().max(2000),
  category: z.string().trim().max(60),
  tags: z.array(tagSchema).max(32),
  confirmBeforeRun: z.boolean(),
});

/** Converts Zod issues into a { field: message } map (first issue per field). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Splits a comma/whitespace separated tag string into unique tags. */
export function parseTags(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input.split(",")) {
    const t = raw.trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      tags.push(t);
    }
  }
  return tags;
}
