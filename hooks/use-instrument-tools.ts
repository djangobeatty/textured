"use client";

import { useEffect, useRef } from "react";
import type { Instrument } from "@/hooks/use-instrument";

// WebMCP (webmachinelearning/webmcp) lets a page offer tools to an AI agent
// running inside the visitor's own browser. The draft attaches the registry to
// navigator.modelContext; earlier previews used document.modelContext. Nothing
// here is reachable over the network, and no shipping browser exposes it yet.
type ModelContext = {
  registerTool: (tool: unknown) => unknown;
  unregisterTool?: (name: string) => unknown;
};

function modelContext(): ModelContext | undefined {
  const scope = globalThis as unknown as {
    navigator?: { modelContext?: ModelContext };
    document?: { modelContext?: ModelContext };
  };
  return scope.navigator?.modelContext ?? scope.document?.modelContext;
}

export function useInstrumentTools(instrument: Instrument) {
  const { description, patch, patchTitle, source, playing, interpret, editDescription } = instrument;
  const latest = useRef({ description, patch, patchTitle, source, playing });
  useEffect(() => {
    latest.current = { description, patch, patchTitle, source, playing };
  }, [description, patch, patchTitle, source, playing]);
  useEffect(() => {
    const context = modelContext();
    if (!context?.registerTool) return;
    const names: string[] = [];
    const register = (tool: { name: string; [key: string]: unknown }) => {
      try {
        void Promise.resolve(context.registerTool(tool)).catch(() => {});
        names.push(tool.name);
      } catch {}
    };
    register({
      name: "read_synth_patch",
      description:
        "Read the current visible synthesiser description, controls, source and playback state.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => latest.current,
    });
    register({
      name: "interpret_sound_description",
      description:
        "Interpret a description with TypeSafe and update the visible synthesiser controls. Uses one API request; preserves playback state and does not start audio.",
      inputSchema: {
        type: "object",
        properties: {
          description: { type: "string", minLength: 1, maxLength: 400 },
        },
        required: ["description"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (input: unknown) => {
        const value = input as { description?: unknown };
        if (
          typeof value?.description !== "string" ||
          !value.description.trim() ||
          value.description.length > 400
        )
          throw new Error("Supply a description of 1–400 characters.");
        editDescription(value.description);
        const r = await interpret(value.description);
        if (!r) throw new Error("Interpretation was cancelled.");
        return {
          description: value.description,
          patch: r.patch,
          model: r.model,
          elapsedMs: r.elapsedMs,
        };
      },
    });
    return () => {
      for (const name of names) {
        try { void Promise.resolve(context.unregisterTool?.(name)).catch(() => {}); } catch {}
      }
    };
  }, [interpret, editDescription]);
}
