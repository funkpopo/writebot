import { describe, expect, it } from "bun:test";
import {
  checkpointStatusToRunState,
  createTrackedAgentRunState,
  InvalidAgentRunTransitionError,
  isAgentCheckpointStatus,
  isAgentNodeId,
  reduceAgentRunState,
  runStateToCheckpointStatus,
} from "../../../../../utils/agentRunState";

describe("agent run state machine", () => {
  it("enumerates valid node ids", () => {
    expect(isAgentNodeId("planning")).toBe(true);
    expect(isAgentNodeId("writing_sections")).toBe(true);
    expect(isAgentNodeId("unknown_node")).toBe(false);
  });

  it("enumerates valid checkpoint statuses", () => {
    expect(isAgentCheckpointStatus("running")).toBe(true);
    expect(isAgentCheckpointStatus("completed")).toBe(true);
    expect(isAgentCheckpointStatus("unknown")).toBe(false);
  });

  it("transitions through the confirmation path", () => {
    let state = reduceAgentRunState("idle", { type: "start", nodeId: "planning" });
    expect(state).toBe("running");

    state = reduceAgentRunState(state, { type: "await_confirmation" });
    expect(state).toBe("awaiting_confirmation");

    state = reduceAgentRunState(state, { type: "confirm" });
    expect(state).toBe("running");

    state = reduceAgentRunState(state, { type: "complete" });
    expect(state).toBe("completed");
  });

  it("rejects invalid transitions", () => {
    expect(() => reduceAgentRunState("idle", { type: "complete" })).toThrow(InvalidAgentRunTransitionError);
    expect(() => reduceAgentRunState("idle", { type: "fail" })).toThrow(InvalidAgentRunTransitionError);
    expect(() => reduceAgentRunState("completed", { type: "enter_node", nodeId: "planning" })).toThrow(
      InvalidAgentRunTransitionError,
    );
  });

  it("allows reset from terminal states", () => {
    let state = reduceAgentRunState("completed", { type: "reset" });
    expect(state).toBe("idle");

    state = reduceAgentRunState("cancelled", { type: "reset" });
    expect(state).toBe("idle");

    state = reduceAgentRunState("error", { type: "reset" });
    expect(state).toBe("idle");
  });

  it("maps checkpoint status without losing confirmation state", () => {
    expect(checkpointStatusToRunState("running", "awaiting_confirmation")).toBe("awaiting_confirmation");
    expect(checkpointStatusToRunState("running", "writing_sections")).toBe("running");
    expect(checkpointStatusToRunState("cancelled", "awaiting_confirmation")).toBe("cancelled");

    expect(runStateToCheckpointStatus("awaiting_confirmation")).toBe("running");
    expect(runStateToCheckpointStatus("completed")).toBe("completed");
  });
});

describe("TrackedAgentRunState", () => {
  it("tracks transition history", () => {
    const tracked = createTrackedAgentRunState("idle");
    expect(tracked.current).toBe("idle");
    expect(tracked.history).toHaveLength(0);

    tracked.transition({ type: "start", nodeId: "planning" });
    expect(tracked.current).toBe("running");
    expect(tracked.history).toHaveLength(1);
    expect(tracked.history[0].event.type).toBe("start");

    tracked.transition({ type: "complete" });
    expect(tracked.current).toBe("completed");
    expect(tracked.history).toHaveLength(2);
  });

  it("reset clears history", () => {
    const tracked = createTrackedAgentRunState("running");
    tracked.transition({ type: "complete" });
    expect(tracked.current).toBe("completed");

    tracked.reset();
    expect(tracked.current).toBe("idle");
    expect(tracked.history).toHaveLength(0);
  });
});
