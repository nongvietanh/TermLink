import { describe, expect, it } from "vitest";

import { setTransport, type Transport } from "@/lib/ipc";

import { WriteQueue } from "./controller";

function slowTransport(delays: number[]) {
  const received: { id: string; data: string }[] = [];
  let call = 0;
  const transport: Transport = {
    invoke: async <T>(cmd: string, args?: Record<string, unknown>) => {
      if (cmd !== "session_write") throw new Error(cmd);
      // Earlier writes finish later: without serialization they would be reordered.
      await new Promise((r) => setTimeout(r, delays[call++ % delays.length]));
      received.push({ id: args!.id as string, data: args!.data as string });
      return undefined as T;
    },
    openSession: async () => {
      throw new Error("unused");
    },
  };
  return { transport, received };
}

describe("WriteQueue", () => {
  it("delivers input in order and batches while a write is in flight", async () => {
    const { transport, received } = slowTransport([30, 1, 1]);
    setTransport(transport);
    const q = new WriteQueue();
    q.setSession("s1");
    q.push("l");
    q.push("s");
    q.push(" ");
    q.push("-la\r");
    await new Promise((r) => setTimeout(r, 120));
    expect(received.map((r) => r.data).join("")).toBe("ls -la\r");
    // First keystroke alone, the rest coalesced into one call.
    expect(received.length).toBe(2);
    expect(received.every((r) => r.id === "s1")).toBe(true);
  });

  it("holds input until the session id is known", async () => {
    const { transport, received } = slowTransport([1]);
    setTransport(transport);
    const q = new WriteQueue();
    q.push("\u001b[1;1R"); // e.g. xterm answering a cursor-position request
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual([]);
    q.setSession("s2");
    await new Promise((r) => setTimeout(r, 20));
    expect(received).toEqual([{ id: "s2", data: "\u001b[1;1R" }]);
  });

  it("drops input after the session ends", async () => {
    let calls = 0;
    setTransport({
      invoke: async () => {
        calls++;
        throw { kind: "session_closed", message: "closed" };
      },
      openSession: async () => {
        throw new Error("unused");
      },
    });
    const q = new WriteQueue();
    q.setSession("gone");
    q.push("a");
    q.push("b");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1);
  });
});
