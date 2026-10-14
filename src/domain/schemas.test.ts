import { describe, expect, it } from "vitest";

import type { ProfileInput } from "./types";
import {
  fieldErrors,
  isValidHost,
  parseTags,
  parseTarget,
  profileInputSchema,
  quickConnectSchema,
  snippetInputSchema,
} from "./schemas";

const profile = (patch: Partial<ProfileInput> = {}): ProfileInput => ({
  groupId: null,
  name: "web",
  protocol: "ssh",
  host: "web.example.com",
  port: 22,
  username: "deploy",
  authMethod: "password",
  keyPath: null,
  favorite: false,
  notes: "",
  color: null,
  tags: [],
  terminal: {},
  ssh: { connectTimeoutSecs: 15, keepaliveIntervalSecs: 30, keepaliveMax: 3, env: [] },
  ...patch,
});

describe("host validation (mirrors the Rust validator)", () => {
  it.each([
    "example.com",
    "srv-01.internal",
    "localhost",
    "10.0.0.1",
    "::1",
    "[2001:db8::1]",
    "fe80::1",
    "host_x.lan",
    "example.com.",
  ])("accepts %s", (h) => expect(isValidHost(h)).toBe(true));
  it.each([
    "",
    " ",
    "-oProxyCommand=evil",
    "bad host",
    "host..double",
    "exa$mple.com",
    "a".repeat(254),
    `${"a".repeat(64)}.com`,
    "1.2.3.4.5:",
  ])("rejects %j", (h) => expect(isValidHost(h)).toBe(false));
});

describe("parseTarget", () => {
  it("parses user, host and port", () => {
    expect(parseTarget("root@db.local:2222")).toEqual({
      username: "root",
      host: "db.local",
      port: 2222,
    });
    expect(parseTarget("db.local")).toEqual({
      username: undefined,
      host: "db.local",
      port: undefined,
    });
    expect(parseTarget("me@[2001:db8::1]:22")).toEqual({
      username: "me",
      host: "2001:db8::1",
      port: 22,
    });
    expect(parseTarget("2001:db8::1")).toEqual({
      username: undefined,
      host: "2001:db8::1",
      port: undefined,
    });
    expect(parseTarget("user@domain@host")).toEqual({
      username: "user@domain",
      host: "host",
      port: undefined,
    });
  });
});

describe("profileInputSchema", () => {
  it("accepts a valid profile", () => {
    expect(profileInputSchema.safeParse(profile()).success).toBe(true);
  });

  it("reports field errors", () => {
    const r = profileInputSchema.safeParse(profile({ host: "bad host", port: 0, username: "" }));
    expect(r.success).toBe(false);
    const errors = fieldErrors(r.error!);
    expect(Object.keys(errors).sort()).toEqual(["host", "port", "username"]);
  });

  it("requires a key file for public key auth", () => {
    const r = profileInputSchema.safeParse(profile({ authMethod: "public_key", keyPath: "" }));
    expect(r.success).toBe(false);
    expect(fieldErrors(r.error!).keyPath).toMatch(/key file/i);
    expect(
      profileInputSchema.safeParse(
        profile({ authMethod: "public_key", keyPath: "~/.ssh/id_ed25519" }),
      ).success,
    ).toBe(true);
  });

  it("does not require host for local profiles", () => {
    expect(
      profileInputSchema.safeParse(profile({ protocol: "local", host: "", username: "" })).success,
    ).toBe(true);
  });

  it("validates advanced options", () => {
    const bad = profileInputSchema.safeParse(
      profile({
        ssh: {
          connectTimeoutSecs: 0,
          keepaliveIntervalSecs: 99999,
          keepaliveMax: 3,
          env: [{ name: "1BAD", value: "x" }],
        },
      }),
    );
    expect(bad.success).toBe(false);
    const keys = Object.keys(fieldErrors(bad.error!));
    expect(keys).toEqual(
      expect.arrayContaining([
        "ssh.connectTimeoutSecs",
        "ssh.keepaliveIntervalSecs",
        "ssh.env.0.name",
      ]),
    );
  });
});

describe("quickConnectSchema", () => {
  it("merges target parts with fields", () => {
    const r = quickConnectSchema.safeParse({
      target: "admin@10.0.0.5:2200",
      username: "ignored",
      port: 22,
      authMethod: "password",
      keyPath: null,
    });
    expect(r.success).toBe(true);
    expect(r.data).toMatchObject({ host: "10.0.0.5", username: "admin", port: 2200 });
  });

  it("requires a username", () => {
    const r = quickConnectSchema.safeParse({
      target: "10.0.0.5",
      username: "",
      port: 22,
      authMethod: "agent",
      keyPath: null,
    });
    expect(r.success).toBe(false);
    expect(fieldErrors(r.error!).username).toBeDefined();
  });

  it("rejects option-injection hosts", () => {
    const r = quickConnectSchema.safeParse({
      target: "-oProxyCommand=calc",
      username: "x",
      port: 22,
      authMethod: "password",
      keyPath: null,
    });
    expect(r.success).toBe(false);
  });
});

describe("snippets and tags", () => {
  it("parses unique tags", () => {
    expect(parseTags("prod, web, PROD,  ,db")).toEqual(["prod", "web", "db"]);
  });

  it("requires a non-blank command", () => {
    const base = {
      name: "x",
      command: "   ",
      description: "",
      category: "",
      tags: [],
      confirmBeforeRun: false,
    };
    expect(snippetInputSchema.safeParse(base).success).toBe(false);
    expect(snippetInputSchema.safeParse({ ...base, command: "ls" }).success).toBe(true);
  });
});
