// Demo without credentials: real Qloo envelopes recorded from a live `qloo exec` run, replayed through the same
// harness client. Only the recorded example works; anything else fails loudly instead of inventing results.

/** Order-independent key for one workflow call. */
function keyOf(op, input) {
  const sort = (v) => (Array.isArray(v) ? v.map(sort)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v);
  return JSON.stringify([op, sort(input)]);
}

/** Wrap a live runner and keep every (workflow, input) -> envelope pair. */
export function recorder(run) {
  const calls = [];
  return {
    run: async (op, input) => {
      const output = await run(op, input);
      calls.push({ op, input, output });
      return output;
    },
    recording: () => calls,
  };
}

/** A runner that answers only from a recording. */
export function replay(recording) {
  const byKey = new Map(recording.map((c) => [keyOf(c.op, c.input), c.output]));
  return async (op, input) => {
    const hit = byKey.get(keyOf(op, input));
    if (!hit) throw new Error("demo mode only has the recorded example (Vienna; Radiohead + Wes Anderson / Taylor Swift + Studio Ghibli)");
    return structuredClone(hit);
  };
}
