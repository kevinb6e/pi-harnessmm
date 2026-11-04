/**
 * Host-compat surface of extensions/harnessmm.ts.
 *
 * pi and OMP load the same factory with different ctx shapes. These pin the
 * feature detection so a refactor cannot silently drop one host:
 *   - before_agent_start: pi mutates systemPromptOptions.sections, OMP returns
 *     a systemPrompt override (and skips reason "revive")
 *   - execute: pi dispatches substitutes through ctx.executeTool with
 *     modelRegistry.complete as selector; OMP has neither and falls back to
 *     runTerminal + runEphemeralTurn
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import harnessmm from "../extensions/harnessmm.ts";

const BANK_AB = '<CHISEL_PLAN>{"candidates":[{"candidate_id":"A","predecessor_id":"root","tool":"terminal","arguments":{"command":"echo PICKED-A"},"guard":{"return_code":0},"required_receipt_fields":["return_code"],"expected_local_cost":{"selector_upper_tokens":8192},"dependency_ids":[]},{"candidate_id":"B","predecessor_id":"root","tool":"terminal","arguments":{"command":"echo PICKED-B"},"guard":{"return_code":0},"required_receipt_fields":["return_code"],"expected_local_cost":{"selector_upper_tokens":8192},"dependency_ids":[]}]}</CHISEL_PLAN>';

function fakePi() {
  const handlers = new Map<string, (event: any, ctx: any) => any>();
  const tools = new Map<string, any>();
  const entries: any[] = [];
  const pi: any = {
    on: (name: string, handler: any) => void handlers.set(name, handler),
    registerTool: (def: any) => void tools.set(def.name, def),
    registerCommand: () => {},
    appendEntry: (customType: string, data: any) => entries.push({ customType, data }),
  };
  return { pi, handlers, tools, entries };
}

function branchWith(bank: string) {
  return [
    { type: "message", message: { role: "user", content: [{ type: "text", text: "do it" }] } },
    {
      type: "message",
      message: {
        role: "assistant",
        usage: { totalTokens: 16000 },
        content: [
          { type: "text", text: bank },
          { type: "toolCall", id: "call_root", name: "terminal", arguments: { command: "echo root-ok" } },
        ],
      },
    },
  ];
}

const baseCtx = (branch: any[]) => ({
  cwd: process.cwd(),
  sessionManager: { getBranch: () => branch, getSessionId: () => "test-session" },
  model: { id: "m" },
});

test("before_agent_start serves pi sections, OMP override, and skips revive", async () => {
  const { pi, handlers } = fakePi();
  harnessmm(pi);
  const fire = handlers.get("before_agent_start")!;

  const piEvent: any = { systemPromptOptions: { sections: { other: "keep" } } };
  await fire(piEvent, {});
  assert.equal(piEvent.systemPromptOptions.sections.other, "keep");
  assert.match(piEvent.systemPromptOptions.sections["harnessmm-authoring"], /<CHISEL_PLAN>/);

  const omp: any = await fire({ systemPrompt: ["base"], reason: "prompt" }, {});
  assert.deepEqual(omp.systemPrompt.slice(0, 1), ["base"], "base prompt preserved for cache prefix");
  assert.match(omp.systemPrompt[1], /<CHISEL_PLAN>/);

  assert.equal(await fire({ systemPrompt: ["base"], reason: "revive" }, {}), undefined);
});

test("OMP-shaped ctx: selector rides runEphemeralTurn, substitute runs via runTerminal", async () => {
  const { pi, tools, entries } = fakePi();
  harnessmm(pi);
  const tool = tools.get("terminal");
  const ctx: any = {
    ...baseCtx(branchWith(BANK_AB)),
    modelRegistry: {}, // OMP: catalog with no complete()
    runEphemeralTurn: async (options: any) => {
      assert.equal(options.tools, false);
      assert.match(options.promptText, /Select an eligible literal continuation/);
      return { replyText: "A", assistantMessage: { usage: { input: 10, output: 1, totalTokens: 11 } } };
    },
    // no executeTool: OMP exposes none for extension tools
  };

  const result = await tool.execute("call_root", { command: "echo root-ok" }, undefined, undefined, ctx);
  assert.match(result.content[0].text, /1 substitution\(s\) certified/);
  const labels = result.details.receipts.map((r: any) => r.label);
  assert.deepEqual(labels, ["root", "A"], "selector label A committed, B not");
  assert.equal(result.details.receipts[1].receipt.stdout, "PICKED-A\n");
  const cert = result.details.certificates[0];
  assert.equal(cert.schema, "certified-native-substitution/v1");
  assert.equal(cert.valid_substitution, true);
  assert.ok(entries.some(entry => entry.data?.kind === "harnessmm/receipt"));
});

test("pi-shaped ctx: executeTool dispatch and modelRegistry.complete still win", async () => {
  const { pi, tools } = fakePi();
  harnessmm(pi);
  const tool = tools.get("terminal");
  const executed: string[] = [];
  const ctx: any = {
    ...baseCtx(branchWith(BANK_AB)),
    modelRegistry: {
      complete: async () => ({ content: [{ type: "text", text: "B" }], usage: { input: 10, output: 1, totalTokens: 11 } }),
    },
    executeTool: async (_name: string, args: any) => {
      executed.push(args.command);
      return {
        result: { content: [{ type: "text", text: JSON.stringify({ return_code: 0, stdout: "via-executeTool\n", stderr: null }) }] },
        isError: false,
      };
    },
  };

  const result = await tool.execute("call_root", { command: "echo root-ok" }, undefined, undefined, ctx);
  assert.deepEqual(executed, ["echo PICKED-B"], "complete() chose B; substitute dispatched through executeTool");
  assert.equal(result.details.receipts.find((r: any) => r.label === "B").receipt.stdout, "via-executeTool\n");
  assert.match(result.content[0].text, /1 substitution\(s\) certified/);
});
