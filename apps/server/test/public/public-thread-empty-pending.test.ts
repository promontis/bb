import { getThread, listQueuedThreadMessages } from "@bb/db";
import { threadSchema } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  listQueuedThreadCommands,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";
import { listEvents } from "@bb/db/testing";

describe("empty pending threads", () => {
  it("waits for its first message, then starts with it", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });

      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          environment: { type: "reuse", environmentId: environment.id },
          input: [],
        }),
      });
      expect(response.status).toBe(201);
      const thread = threadSchema.parse(await readJson(response));
      expect(thread.status).toBe("pending");
      expect(thread.environmentId).toBe(environment.id);
      expect(thread.title).toBeNull();
      expect(thread.titleFallback).toBeNull();
      expect(listEvents(harness.db, { threadId: thread.id })).toEqual([]);
      expect(listQueuedThreadMessages(harness.db, thread.id)).toEqual([]);
      expect(
        listQueuedThreadCommands(harness, "thread.start", thread.id),
      ).toEqual([]);

      const send = await harness.app.request(
        `/api/v1/threads/${thread.id}/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: textInput("first message"),
            mode: "queue-if-active",
          }),
        },
      );
      expect(send.status).toBe(200);
      const started = getThread(harness.db, thread.id);
      expect(started?.status).not.toBe("pending");
      expect(started?.titleFallback).toBe("first message");
      const queuedStart = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      if (queuedStart.command.type !== "thread.start") {
        throw new Error("Expected a thread.start command");
      }
      expect(queuedStart.command.input).toEqual(textInput("first message"));
      expect(queuedStart.command.fork).toBeUndefined();
    });
  });

  it("rejects a schedule on an empty thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const response = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          environment: { type: "reuse", environmentId: environment.id },
          input: [],
          sendAt: Date.now() + 60_000,
        }),
      });
      expect(response.status).toBe(400);
    });
  });
});
